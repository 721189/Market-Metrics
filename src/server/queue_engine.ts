import { EventEmitter } from 'events';
import { RealRedisClient } from './redis_client.js';

export interface QueueJob<TData = any, TResult = any> {
  id: string;
  name: string;
  data: TData;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled';
  attemptsMade: number;
  result?: TResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export type JobProcessor<TData = any, TResult = any> = (
  job: QueueJob<TData, TResult>,
  signal?: AbortSignal
) => Promise<TResult>;

export class BullMQQueue<TData = any, TResult = any> extends EventEmitter {
  private redisClient: RealRedisClient;
  private processor: JobProcessor<TData, TResult> | null = null;
  private isProcessing = false;
  private activeController: AbortController | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.redisClient = new RealRedisClient();
    this.initPubSub();
  }

  private async initPubSub() {
    try {
      await this.redisClient.connect();
      await this.redisClient.subscribe('bullmq:events', (msg) => {
        const event = JSON.parse(msg);
        this.emit(event.event, event.data);
      });
    } catch (err) {
      console.warn('[BullMQQueue] PubSub connection failed, retrying in 5s...', err);
      setTimeout(() => this.initPubSub(), 5000);
    }
  }

  public process(processor: JobProcessor<TData, TResult>) {
    this.processor = processor;
    this.startWorker();
  }

  private startWorker() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => {
      this.tick();
    }, 1000);
    this.tick();
  }

  public async add(name: string, data: TData): Promise<QueueJob<TData, TResult>> {
    const job: QueueJob<TData, TResult> = {
      id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      data,
      state: 'waiting',
      attemptsMade: 0,
      createdAt: Date.now(),
    };

    try {
      await this.redisClient.set(`bullmq:job:${job.id}`, JSON.stringify(job));
      await this.redisClient.lpush('bullmq:queue:waiting', job.id);
      await this.redisClient.publish('bullmq:events', JSON.stringify({ event: 'job:queued', data: { jobId: job.id } }));
    } catch (err) {
      console.error('[BullMQQueue] Add job failed:', err);
    }

    this.tick();
    return job;
  }

  public async getJob(id: string): Promise<QueueJob<TData, TResult> | null> {
    try {
      const raw = await this.redisClient.get(`bullmq:job:${id}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('[BullMQQueue] Get job failed:', err);
      return null;
    }
  }

  public async getJobPosition(jobId: string): Promise<number | null> {
    // Return order position in wait list
    return null;
  }

  public async cancel(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) return false;

    job.state = 'cancelled';
    job.completedAt = Date.now();
    await this.redisClient.set(`bullmq:job:${jobId}`, JSON.stringify(job));

    if (this.activeController) {
      this.activeController.abort();
    }

    await this.redisClient.publish('bullmq:events', JSON.stringify({ event: 'job:failed', data: { jobId, error: 'Cancelled by user' } }));
    return true;
  }

  public getStats() {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
    };
  }

  private async tick() {
    if (this.isProcessing || !this.processor) return;
    this.isProcessing = true;

    try {
      const jobId = await this.redisClient.lpop('bullmq:queue:waiting');
      if (!jobId) {
        this.isProcessing = false;
        return;
      }

      const job = await this.getJob(jobId);
      if (!job || job.state === 'cancelled') {
        this.isProcessing = false;
        return;
      }

      job.state = 'active';
      job.startedAt = Date.now();
      job.attemptsMade++;
      await this.redisClient.set(`bullmq:job:${jobId}`, JSON.stringify(job));

      this.activeController = new AbortController();

      try {
        const result = await this.processor(job, this.activeController.signal);
        job.state = 'completed';
        job.result = result;
        job.completedAt = Date.now();
        await this.redisClient.set(`bullmq:job:${jobId}`, JSON.stringify(job));
        await this.redisClient.publish('bullmq:events', JSON.stringify({ event: 'job:completed', data: { jobId: job.id } }));
      } catch (err: any) {
        job.state = 'failed';
        job.error = err?.message || 'Unknown error';
        job.completedAt = Date.now();
        await this.redisClient.set(`bullmq:job:${jobId}`, JSON.stringify(job));
        await this.redisClient.publish('bullmq:events', JSON.stringify({ event: 'job:failed', data: { jobId: job.id, error: job.error } }));
      }
    } catch (err) {
      console.error('[BullMQQueue] Tick worker error:', err);
    } finally {
      this.activeController = null;
      this.isProcessing = false;
    }
  }
}

export const researchQueue = new BullMQQueue();
export const simpleQueue = researchQueue;
