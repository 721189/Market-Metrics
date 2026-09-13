import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { RealRedisClient } from './redis_client.js';
import { EventEmitter } from 'events';

const redisClientWrapper = new RealRedisClient();
const connection = redisClientWrapper.getClient();

// BullMQ Real Queue
const bullQueue = new Queue('market-research-execution', { 
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
  }
});

class ResearchQueueWrapper extends EventEmitter {
  private worker: Worker | null = null;

  public async add(name: string, data: any): Promise<any> {
    const job = await bullQueue.add(name, data);
    return { id: job.id, ...job };
  }

  public async getJob(id: string): Promise<any> {
    return await bullQueue.getJob(id);
  }

  public async getJobPosition(jobId: string): Promise<number | null> {
    return 1;
  }

  public async cancel(jobId: string): Promise<boolean> {
    const job = await bullQueue.getJob(jobId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }

  public getStats() {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
    };
  }

  public process(processor: (job: any, signal?: AbortSignal) => Promise<any>) {
    this.worker = new Worker('market-research-execution', async (job) => {
      // Adapt BullMQ Job to the pipeline's expected format if needed
      // But pipeline.ts expects (queueJob, signal)
      // Wait, pipeline.ts line 667: researchQueue.process(async (queueJob, signal) => { ... })
      return await processor(job, new AbortController().signal);
    }, { 
      connection,
      concurrency: 5 
    });
  }
}

export const researchQueue = new ResearchQueueWrapper();
export const simpleQueue = researchQueue;
