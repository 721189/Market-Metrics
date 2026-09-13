export class RealRedisServer {
  private static instance: RealRedisServer;
  static getInstance(): RealRedisServer {
    if (!RealRedisServer.instance) {
      RealRedisServer.instance = new RealRedisServer();
    }
    return RealRedisServer.instance;
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
