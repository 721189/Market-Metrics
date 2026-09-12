import net from 'net';

export class RealRedisServer {
  private static instance: RealRedisServer | null = null;
  private server: net.Server | null = null;
  private port = 6379;
  private host = '127.0.0.1';

  private db = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private subscribers = new Set<net.Socket>();
  private channelSubs = new Map<string, Set<net.Socket>>();

  private constructor() {}

  public static getInstance(): RealRedisServer {
    if (!RealRedisServer.instance) {
      RealRedisServer.instance = new RealRedisServer();
    }
    return RealRedisServer.instance;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', (data) => {
          buffer += data.toString();
          this.processBuffer(socket, buffer, (remainingBuffer) => {
            buffer = remainingBuffer;
          });
        });

        socket.on('close', () => {
          this.subscribers.delete(socket);
          for (const [chan, subs] of this.channelSubs.entries()) {
            subs.delete(socket);
            if (subs.size === 0) {
              this.channelSubs.delete(chan);
            }
          }
        });

        socket.on('error', (err) => {
          console.warn('[Redis Server] Socket error:', err.message);
        });
      });

      this.server.listen(this.port, this.host, () => {
        console.log(`[Redis Server] Real Redis listening on tcp://${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.log('[Redis Server] Redis port 6379 is already in use, assuming external Redis is running.');
          resolve();
        } else {
          console.error('[Redis Server] Server error:', err);
          resolve();
        }
      });
    });
  }

  public stop() {
    if (this.server) {
      this.server.close();
    }
  }

  private processBuffer(socket: net.Socket, buffer: string, updateBuffer: (rem: string) => void) {
    let index = 0;

    while (index < buffer.length) {
      if (buffer[index] !== '*') {
        // Simple command like PING\n or inline commands
        const nextLine = buffer.indexOf('\r\n', index);
        if (nextLine === -1) break;
        const line = buffer.substring(index, nextLine).trim();
        const parts = line.split(/\s+/);
        if (parts.length > 0 && parts[0]) {
          this.executeCommand(socket, parts);
        }
        index = nextLine + 2;
        continue;
      }

      // RESP Array format
      const arrayEnd = buffer.indexOf('\r\n', index);
      if (arrayEnd === -1) break;

      const arrayLen = parseInt(buffer.substring(index + 1, arrayEnd), 10);
      if (isNaN(arrayLen)) {
        socket.write('-ERR Protocol Error\r\n');
        break;
      }

      let tempIndex = arrayEnd + 2;
      const args: string[] = [];
      let parsedAll = true;

      for (let i = 0; i < arrayLen; i++) {
        if (tempIndex >= buffer.length || buffer[tempIndex] !== '$') {
          parsedAll = false;
          break;
        }
        const lenEnd = buffer.indexOf('\r\n', tempIndex);
        if (lenEnd === -1) {
          parsedAll = false;
          break;
        }
        const strLen = parseInt(buffer.substring(tempIndex + 1, lenEnd), 10);
        tempIndex = lenEnd + 2;

        if (tempIndex + strLen + 2 > buffer.length) {
          parsedAll = false;
          break;
        }
        const value = buffer.substring(tempIndex, tempIndex + strLen);
        args.push(value);
        tempIndex += strLen + 2;
      }

      if (!parsedAll) break;

      index = tempIndex;
      this.executeCommand(socket, args);
    }

    updateBuffer(buffer.substring(index));
  }

  private executeCommand(socket: net.Socket, args: string[]) {
    if (args.length === 0) return;
    const cmd = args[0].toUpperCase();

    try {
      switch (cmd) {
        case 'PING':
          socket.write('+PONG\r\n');
          break;

        case 'SET': {
          const [_, key, value] = args;
          this.db.set(key, value);
          socket.write('+OK\r\n');
          break;
        }

        case 'GET': {
          const [_, key] = args;
          if (this.db.has(key)) {
            const val = this.db.get(key)!;
            socket.write(`$${Buffer.byteLength(val)}\r\n${val}\r\n`);
          } else {
            socket.write('$-1\r\n');
          }
          break;
        }

        case 'DEL': {
          let deleted = 0;
          for (let i = 1; i < args.length; i++) {
            if (this.db.delete(args[i])) deleted++;
            if (this.lists.delete(args[i])) deleted++;
            if (this.sets.delete(args[i])) deleted++;
          }
          socket.write(`:${deleted}\r\n`);
          break;
        }

        case 'LPUSH': {
          const key = args[1];
          if (!this.lists.has(key)) this.lists.set(key, []);
          const list = this.lists.get(key)!;
          for (let i = 2; i < args.length; i++) {
            list.unshift(args[i]);
          }
          socket.write(`:${list.length}\r\n`);
          break;
        }

        case 'RPUSH': {
          const key = args[1];
          if (!this.lists.has(key)) this.lists.set(key, []);
          const list = this.lists.get(key)!;
          for (let i = 2; i < args.length; i++) {
            list.push(args[i]);
          }
          socket.write(`:${list.length}\r\n`);
          break;
        }

        case 'LPOP': {
          const key = args[1];
          const list = this.lists.get(key);
          if (!list || list.length === 0) {
            socket.write('$-1\r\n');
          } else {
            const val = list.shift()!;
            socket.write(`$${Buffer.byteLength(val)}\r\n${val}\r\n`);
          }
          break;
        }

        case 'RPOPLPUSH': {
          const src = args[1];
          const dest = args[2];
          const srcList = this.lists.get(src);
          if (!srcList || srcList.length === 0) {
            socket.write('$-1\r\n');
          } else {
            const val = srcList.pop()!;
            if (!this.lists.has(dest)) this.lists.set(dest, []);
            this.lists.get(dest)!.unshift(val);
            socket.write(`$${Buffer.byteLength(val)}\r\n${val}\r\n`);
          }
          break;
        }

        case 'LLEN': {
          const key = args[1];
          const list = this.lists.get(key) || [];
          socket.write(`:${list.length}\r\n`);
          break;
        }

        case 'SADD': {
          const key = args[1];
          if (!this.sets.has(key)) this.sets.set(key, new Set());
          const set = this.sets.get(key)!;
          let added = 0;
          for (let i = 2; i < args.length; i++) {
            if (!set.has(args[i])) {
              set.add(args[i]);
              added++;
            }
          }
          socket.write(`:${added}\r\n`);
          break;
        }

        case 'SMEMBERS': {
          const key = args[1];
          const set = this.sets.get(key) || new Set();
          const items = Array.from(set);
          socket.write(`*${items.length}\r\n`);
          for (const item of items) {
            socket.write(`$${Buffer.byteLength(item)}\r\n${item}\r\n`);
          }
          break;
        }

        case 'PUBLISH': {
          const channel = args[1];
          const message = args[2];
          const subs = this.channelSubs.get(channel) || new Set();
          let count = 0;
          for (const sub of subs) {
            // Write publication payload to subscriber
            sub.write(`*3\r\n$7\r\nmessage\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n$${Buffer.byteLength(message)}\r\n${message}\r\n`);
            count++;
          }
          socket.write(`:${count}\r\n`);
          break;
        }

        case 'SUBSCRIBE': {
          for (let i = 1; i < args.length; i++) {
            const channel = args[i];
            if (!this.channelSubs.has(channel)) this.channelSubs.set(channel, new Set());
            this.channelSubs.get(channel)!.add(socket);
            this.subscribers.add(socket);
            // Write subscribe confirmation to connection
            socket.write(`*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n:${i}\r\n`);
          }
          break;
        }

        default:
          socket.write(`-ERR unknown command '${cmd}'\r\n`);
          break;
      }
    } catch (err: any) {
      socket.write(`-ERR ${err.message || 'unknown error'}\r\n`);
    }
  }
}
