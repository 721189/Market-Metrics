import net from 'net';
import { EventEmitter } from 'events';

export class RealRedisClient {
  private socket: net.Socket | null = null;
  private host = '127.0.0.1';
  private port = 6379;
  private isConnected = false;
  private isFallbackMode = false;
  private memoryStore = new Map<string, string>();
  private memoryLists = new Map<string, string[]>();
  private pubSubEmitter = new EventEmitter();
  private subCallbacks = new Map<string, ((msg: string) => void)[]>();
  private subSocket: net.Socket | null = null;
  private fallbackLogged = false;

  constructor() {}

  public connect(): Promise<void> {
    if (this.isFallbackMode) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(1000);

      this.socket.connect(this.port, this.host, () => {
        this.isConnected = true;
        resolve();
      });

      this.socket.on('timeout', () => {
        this.enableFallback('connection timeout');
        resolve();
      });

      this.socket.on('error', (err) => {
        this.enableFallback(err.message);
        resolve();
      });
    });
  }

  private enableFallback(reason: string) {
    if (!this.fallbackLogged) {
      console.info(`[RealRedisClient] Redis not running (${reason}). Using robust in-memory store & queue engine.`);
      this.fallbackLogged = true;
    }
    this.isFallbackMode = true;
    this.isConnected = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  public async get(key: string): Promise<string | null> {
    if (this.isFallbackMode) {
      return this.memoryStore.get(key) || null;
    }
    await this.ensureConnected();
    if (this.isFallbackMode) return this.memoryStore.get(key) || null;

    const cmd = `*2\r\n$3\r\nGET\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(this.memoryStore.get(key) || null), 1000);
      this.socket!.once('data', (data) => {
        clearTimeout(timeout);
        const resp = data.toString();
        if (resp.startsWith('$-1\r\n')) {
          resolve(null);
        } else {
          const firstLineEnd = resp.indexOf('\r\n');
          const value = resp.substring(firstLineEnd + 2, resp.length - 2);
          resolve(value);
        }
      });
      this.socket!.write(cmd);
    });
  }

  public async set(key: string, value: string): Promise<void> {
    if (this.isFallbackMode) {
      this.memoryStore.set(key, value);
      return;
    }
    await this.ensureConnected();
    if (this.isFallbackMode) {
      this.memoryStore.set(key, value);
      return;
    }

    const cmd = `*3\r\n$3\r\nSET\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n$${Buffer.byteLength(value)}\r\n${value}\r\n`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.memoryStore.set(key, value);
        resolve();
      }, 1000);
      this.socket!.once('data', () => {
        clearTimeout(timeout);
        this.memoryStore.set(key, value);
        resolve();
      });
      this.socket!.write(cmd);
    });
  }

  public async lpush(key: string, value: string): Promise<number> {
    if (this.isFallbackMode) {
      if (!this.memoryLists.has(key)) {
        this.memoryLists.set(key, []);
      }
      const list = this.memoryLists.get(key)!;
      list.unshift(value);
      return list.length;
    }
    await this.ensureConnected();
    if (this.isFallbackMode) {
      if (!this.memoryLists.has(key)) this.memoryLists.set(key, []);
      const list = this.memoryLists.get(key)!;
      list.unshift(value);
      return list.length;
    }

    const cmd = `*3\r\n$5\r\nLPUSH\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n$${Buffer.byteLength(value)}\r\n${value}\r\n`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.memoryLists.has(key)) this.memoryLists.set(key, []);
        const list = this.memoryLists.get(key)!;
        list.unshift(value);
        resolve(list.length);
      }, 1000);
      this.socket!.once('data', (data) => {
        clearTimeout(timeout);
        const match = data.toString().match(/:(\d+)\r\n/);
        resolve(match ? parseInt(match[1], 10) : 1);
      });
      this.socket!.write(cmd);
    });
  }

  public async lpop(key: string): Promise<string | null> {
    if (this.isFallbackMode) {
      const list = this.memoryLists.get(key);
      if (!list || list.length === 0) return null;
      return list.shift() || null;
    }
    await this.ensureConnected();
    if (this.isFallbackMode) {
      const list = this.memoryLists.get(key);
      if (!list || list.length === 0) return null;
      return list.shift() || null;
    }

    const cmd = `*2\r\n$4\r\nLPOP\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const list = this.memoryLists.get(key);
        if (!list || list.length === 0) resolve(null);
        else resolve(list.shift() || null);
      }, 1000);
      this.socket!.once('data', (data) => {
        clearTimeout(timeout);
        const resp = data.toString();
        if (resp.startsWith('$-1\r\n')) {
          resolve(null);
        } else {
          const firstLineEnd = resp.indexOf('\r\n');
          const value = resp.substring(firstLineEnd + 2, resp.length - 2);
          resolve(value);
        }
      });
      this.socket!.write(cmd);
    });
  }

  public async publish(channel: string, message: string): Promise<number> {
    if (this.isFallbackMode) {
      this.pubSubEmitter.emit(channel, message);
      const cbs = this.subCallbacks.get(channel) || [];
      cbs.forEach(cb => cb(message));
      return 1;
    }
    await this.ensureConnected();
    if (this.isFallbackMode) {
      this.pubSubEmitter.emit(channel, message);
      const cbs = this.subCallbacks.get(channel) || [];
      cbs.forEach(cb => cb(message));
      return 1;
    }

    const cmd = `*3\r\n$7\r\nPUBLISH\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n$${Buffer.byteLength(message)}\r\n${message}\r\n`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pubSubEmitter.emit(channel, message);
        resolve(1);
      }, 1000);
      this.socket!.once('data', (data) => {
        clearTimeout(timeout);
        const match = data.toString().match(/:(\d+)\r\n/);
        resolve(match ? parseInt(match[1], 10) : 1);
      });
      this.socket!.write(cmd);
    });
  }

  public async subscribe(channel: string, callback: (msg: string) => void): Promise<void> {
    if (!this.subCallbacks.has(channel)) {
      this.subCallbacks.set(channel, []);
    }
    this.subCallbacks.get(channel)!.push(callback);

    if (this.isFallbackMode) {
      return;
    }

    if (!this.subSocket) {
      try {
        await this.initSubSocket();
      } catch (err) {
        this.enableFallback('sub socket error');
        return;
      }
    }

    if (this.isFallbackMode) return;

    const cmd = `*2\r\n$9\r\nSUBSCRIBE\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n`;
    this.subSocket!.write(cmd);
  }

  private initSubSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.subSocket = new net.Socket();
      this.subSocket.setTimeout(1000);
      this.subSocket.connect(this.port, this.host, () => {
        resolve();
      });

      this.subSocket.on('timeout', () => {
        this.enableFallback('sub timeout');
        reject(new Error('sub timeout'));
      });

      this.subSocket.on('data', (data) => {
        const resp = data.toString();
        this.parsePubSubMessages(resp);
      });

      this.subSocket.on('error', (err) => {
        this.enableFallback(err.message);
        reject(err);
      });
    });
  }

  private parsePubSubMessages(resp: string) {
    let index = 0;
    while (index < resp.length) {
      if (resp[index] !== '*') break;
      const arrayEnd = resp.indexOf('\r\n', index);
      if (arrayEnd === -1) break;
      const arrayLen = parseInt(resp.substring(index + 1, arrayEnd), 10);
      if (arrayLen !== 3) {
        index = arrayEnd + 2;
        continue;
      }

      let tempIdx = arrayEnd + 2;
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        if (resp[tempIdx] !== '$') break;
        const lenEnd = resp.indexOf('\r\n', tempIdx);
        const strLen = parseInt(resp.substring(tempIdx + 1, lenEnd), 10);
        tempIdx = lenEnd + 2;
        parts.push(resp.substring(tempIdx, tempIdx + strLen));
        tempIdx += strLen + 2;
      }

      index = tempIdx;

      if (parts[0] === 'message') {
        const channel = parts[1];
        const msg = parts[2];
        const cbs = this.subCallbacks.get(channel) || [];
        cbs.forEach(cb => cb(msg));
      }
    }
  }

  private async ensureConnected() {
    if (this.isFallbackMode) return;
    if (!this.isConnected || !this.socket) {
      await this.connect();
    }
  }

  public close() {
    this.isConnected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.subSocket) {
      this.subSocket.destroy();
      this.subSocket = null;
    }
  }
}
