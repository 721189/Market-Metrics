import { EventEmitter } from 'events';

/**
 * Enterprise Redis Adapter Mock
 * Provides interfaces identical to ioredis for seamless drop-in
 * when connecting to a real Redis cluster in production.
 */
class RedisClientMock extends EventEmitter {
  private store = new Map<string, string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private subscriber = new EventEmitter();

  constructor(public config: any) {
    super();
    // Simulate async connection
    setTimeout(() => this.emit('connect'), 100);
    setTimeout(() => this.emit('ready'), 200);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string, exType?: string, exValue?: number): Promise<'OK'> {
    this.store.set(key, value);
    if (exType === 'EX' && exValue) {
      if (this.timers.has(key)) clearTimeout(this.timers.get(key)!);
      this.timers.set(
        key,
        setTimeout(() => this.store.delete(key), exValue * 1000)
      );
    }
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
      this.timers.delete(key);
    }
    return existed ? 1 : 0;
  }

  // Rate Limiting specific commands (Token Bucket / Sliding Window)
  async multi(): Promise<any> {
    // Simple stub for multi/exec block
    const operations: any[] = [];
    return {
      incr: (key: string) => {
        operations.push(() => {
          const v = parseInt(this.store.get(key) || '0', 10) + 1;
          this.store.set(key, v.toString());
          return [null, v];
        });
        return this;
      },
      expire: (key: string, ttl: number) => {
        operations.push(() => {
          if (this.timers.has(key)) clearTimeout(this.timers.get(key)!);
          this.timers.set(key, setTimeout(() => this.store.delete(key), ttl * 1000));
          return [null, 1];
        });
        return this;
      },
      exec: async () => {
        return operations.map(op => op());
      }
    };
  }

  // Pub/Sub capabilities for SSE Fanout
  async publish(channel: string, message: string): Promise<number> {
    this.subscriber.emit(`message:${channel}`, message);
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    // No-op for mock, listeners handled via on('message')
    return 1;
  }

  async unsubscribe(channel: string): Promise<number> {
    return 1;
  }

  onMessage(channel: string, callback: (msg: string) => void) {
    this.subscriber.on(`message:${channel}`, callback);
  }

  offMessage(channel: string, callback: (msg: string) => void) {
    this.subscriber.off(`message:${channel}`, callback);
  }
}

// Export singleton instances for data and pubsub
export const redisClient = new RedisClientMock({ host: 'redis-primary' });
export const redisSubscriber = new RedisClientMock({ host: 'redis-replica' });

/**
 * Helper to emit SSE Fanout messages
 */
export function publishEventToRedisFanout(channel: string, eventData: any) {
  redisClient.publish(channel, JSON.stringify(eventData));
}
