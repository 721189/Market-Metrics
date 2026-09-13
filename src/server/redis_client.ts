import Redis from 'ioredis';

export class RealRedisClient {
  private client: Redis | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    try {
      this.client = new Redis(redisUrl, { maxRetriesPerRequest: null });
      this.pubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
      this.subClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
      
      this.client.on('error', (err) => console.error('[Redis Client] Error:', err));
    } catch (err) {
      console.error('[Redis Client] Initialization failed:', err);
    }
  }

  public getClient(): Redis {
    if (!this.client) throw new Error('Redis client not initialized');
    return this.client;
  }

  public async connect(): Promise<void> {
    // ioredis connects automatically
  }

  public async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    await this.getClient().set(key, value);
  }

  public async lpush(key: string, value: string): Promise<number> {
    return await this.getClient().lpush(key, value);
  }

  public async lpop(key: string): Promise<string | null> {
    return this.getClient().lpop(key);
  }

  public async publish(channel: string, message: string): Promise<number> {
    if (!this.pubClient) throw new Error('Pub client not initialized');
    return await this.pubClient.publish(channel, message);
  }

  public async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.subClient) throw new Error('Sub client not initialized');
    await this.subClient.subscribe(channel);
    this.subClient.on('message', (chan, msg) => {
      if (chan === channel) {
        callback(msg);
      }
    });
  }

  public close() {
    this.client?.disconnect();
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
  }
}
