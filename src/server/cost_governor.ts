/**
 * Cost governor for the research agent — part 1: config, budgets, caps.
 */

import { RequestCost, UserCost, GlobalCost, JobCost, CostSnapshot } from './cost_types.js';
import { RetrievalArtifact } from './artifacts.js';

export interface CostGovernorConfig {
  maxSources?: number;
  maxDocumentSizeBytes?: number;
  maxModelCalls?: number;
  maxRetries?: number;
  requestBudgetUsd?: number;
  userDailyBudgetUsd?: number;
  globalDailyBudgetUsd?: number;
}

const DEFAULT_CONFIG: Required<CostGovernorConfig> = {
  maxSources: 25,
  maxDocumentSizeBytes: 50 * 1024 * 1024,
  maxModelCalls: 120,
  maxRetries: 3,
  requestBudgetUsd: 25,
  userDailyBudgetUsd: 500,
  globalDailyBudgetUsd: 5000,
};

export class CostGovernor {
  private readonly config: Required<CostGovernorConfig>;
  private readonly requestCost: RequestCost = makeFreshCost();
  private readonly userCosts = new Map<string, UserCost>();
  private readonly jobCosts = new Map<string, JobCost>();
  private globalCost: GlobalCost = makeFreshGlobal();

  constructor(config: CostGovernorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  allowFetch(responseSizeBytes: number): string | null {
    if (responseSizeBytes > this.config.maxDocumentSizeBytes) {
      return `Document too large: ${responseSizeBytes} bytes exceeds ${this.config.maxDocumentSizeBytes} bytes`;
    }
    if (this.requestCost.fetch_calls >= this.config.maxSources) {
      return `Source cap exceeded: ${this.config.maxSources} sources per request`;
    }
    return null;
  }

  allowModelCall(): string | null {
    if (this.requestCost.search_calls >= this.config.maxModelCalls) {
      return `Model call cap exceeded: ${this.config.maxModelCalls} calls per request`;
    }
    return null;
  }

  allowRetry(): string | null {
    if (this.requestCost.output_tokens > this.config.maxRetries) {
      return `Retry cap exceeded: ${this.config.maxRetries} retries per operation`;
    }
    return null;
  }

  checkRequestBudget(): string | null {
    if (this.requestCost.estimated_cost_usd > this.config.requestBudgetUsd) {
      return `Request budget exceeded: $${this.config.requestBudgetUsd} per request`;
    }
    return null;
  }

  checkUserBudget(userId: string, userCost: UserCost): string | null {
    if (userCost.estimated_cost_usd > this.config.userDailyBudgetUsd) {
      return `User daily budget exceeded: $${this.config.userDailyBudgetUsd} per user per day`;
    }
    return null;
  }

  checkGlobalBudget(): string | null {
    if (this.globalCost.estimated_cost_usd > this.config.globalDailyBudgetUsd) {
      return `Global daily budget exceeded: $${this.config.globalDailyBudgetUsd} per day`;
    }
    return null;
  }

  snapshot(jobId?: string): CostSnapshot {
    return {
      request: { ...this.requestCost },
      user: this.currentUserCost(),
      job: this.currentJobCost(jobId),
      global: { ...this.globalCost },
    };
  }

  resetForTest(): void {
    this.requestCost.reset();
    this.userCosts.clear();
    this.jobCosts.clear();
    this.globalCost = makeFreshGlobal();
  }

  recordFetch(_responseSizeBytes: number, estimatedCostUsd: number): void {
    this.requestCost.fetch_calls += 1;
    this.requestCost.documents_processed += 1;
    this.requestCost.estimated_cost_usd += estimatedCostUsd;
    this.requestCost.actual_cost_usd += estimatedCostUsd;
    this.addToUser();
    this.addToJob();
    this.addToGlobal();
  }

  recordModelCall(inputTokens: number, outputTokens: number, estimatedCostUsd: number): string | null {
    const reason = this.allowModelCall();
    if (reason) return reason;

    this.requestCost.input_tokens += inputTokens;
    this.requestCost.output_tokens += outputTokens;
    this.requestCost.search_calls += 1;
    this.requestCost.estimated_cost_usd += estimatedCostUsd;
    this.requestCost.actual_cost_usd += estimatedCostUsd;
    this.addToUser();
    this.addToJob();
    this.addToGlobal();
    return null;
  }

  recordSearchCall(estimatedCostUsd: number): string | null {
    const reason = this.allowModelCall();
    if (reason) return reason;

    this.requestCost.search_calls += 1;
    this.requestCost.estimated_cost_usd += estimatedCostUsd;
    this.requestCost.actual_cost_usd += estimatedCostUsd;
    this.addToUser();
    this.addToJob();
    this.addToGlobal();
    return null;
  }

  sourceArtifacts: Map<string, RetrievalArtifact> = new Map();

  recordArtifact(artifact: RetrievalArtifact): void {
    this.sourceArtifacts.set(artifact.source_id, artifact);
  }

  private addToUser(): void {
    let user = this.userCosts.get('*');
    if (!user) {
      user = makeFreshUser();
      this.userCosts.set('*', user);
    }
    copyInto(user, this.requestCost);
  }

  private addToJob(jobId?: string): void {
    const id = jobId ?? '*';
    let job = this.jobCosts.get(id);
    if (!job) {
      job = makeFreshUser();
      this.jobCosts.set(id, job);
    }
    copyInto(job, this.requestCost);
  }

  private addToGlobal(): void {
    copyInto(this.globalCost, this.requestCost);
  }

  private currentUserCost(): UserCost {
    const user = this.userCosts.get('*');
    return user ? { ...user } : makeFreshUser();
  }

  private currentJobCost(jobId?: string): JobCost {
    const job = this.jobCosts.get(jobId ?? '*');
    return job ? { ...job } : makeFreshUser();
  }
}

function makeFreshCost(): RequestCost {
  return {
    input_tokens: 0,
    output_tokens: 0,
    search_calls: 0,
    fetch_calls: 0,
    documents_processed: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
    reset() {
      this.input_tokens = 0;
      this.output_tokens = 0;
      this.search_calls = 0;
      this.fetch_calls = 0;
      this.documents_processed = 0;
      this.estimated_cost_usd = 0;
      this.actual_cost_usd = 0;
    },
  };
}

function makeFreshUser(): UserCost {
  return {
    input_tokens: 0,
    output_tokens: 0,
    search_calls: 0,
    fetch_calls: 0,
    documents_processed: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
  };
}

function makeFreshGlobal(): GlobalCost {
  return {
    input_tokens: 0,
    output_tokens: 0,
    search_calls: 0,
    fetch_calls: 0,
    documents_processed: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
  };
}

function copyInto(target: RequestCost | UserCost | GlobalCost, source: RequestCost): void {
  target.input_tokens += source.input_tokens;
  target.output_tokens += source.output_tokens;
  target.search_calls += source.search_calls;
  target.fetch_calls += source.fetch_calls;
  target.documents_processed += source.documents_processed;
  target.estimated_cost_usd += source.estimated_cost_usd;
  target.actual_cost_usd += source.actual_cost_usd;
}
