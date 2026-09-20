/**
 * Cost governor for the research agent — part 1: config, budgets, caps.
 *
 * Two accounting layers:
 *   1. Request-scoped caps (in-process, per pipeline run): maxSources,
 *      maxDocumentSizeBytes, maxModelCalls, maxRetries, requestBudgetUsd.
 *      These never leave the pipeline run and stay synchronous.
 *   2. Persistent spend (CostStore): per-user daily + monthly totals and a
 *      global daily total. These survive restarts and are shared across
 *      replicas, so budgets are enforced even when two instances serve the
 *      same user. Selected via COST_STORE (memory default; firestore for
 *      multi-replica; redis reserved for later and fails closed).
 */

import { RequestCost, UserCost, GlobalCost, JobCost, CostSnapshot } from './cost_types.js';
import { RetrievalArtifact } from './artifacts.js';
import { logger } from './logger.js';
import {
  InMemoryCostStore,
  resolveStoreKind,
  throwRedisNotProvisioned,
  type CostStore,
} from './stores.js';

/** Persistent budget caps (USD). Override via constructor config. */
export interface PersistentBudgetConfig {
  /** Maximum spend per user per UTC day. */
  userDailyBudgetUsd?: number;
  /** Maximum spend per user per UTC month. */
  userMonthlyBudgetUsd?: number;
  /** Maximum spend across all users per UTC day (global kill-switch). */
  globalDailyBudgetUsd?: number;
}

const DEFAULT_PERSISTENT_BUDGETS: Required<PersistentBudgetConfig> = {
  userDailyBudgetUsd: 10,
  userMonthlyBudgetUsd: 100,
  globalDailyBudgetUsd: 500,
};

let sharedCostStore: CostStore | null = null;

function getCostStore(): CostStore {
  if (sharedCostStore) return sharedCostStore;
  const kind = resolveStoreKind(process.env.COST_STORE, 'memory');
  if (kind === 'redis') throwRedisNotProvisioned('CostGovernor');
  if (kind === 'firestore') {
    throw new Error(
      '[CostGovernor] COST_STORE=firestore selected but the Firestore cost ' +
        'store is not wired yet. Use memory (single replica).',
    );
  }
  sharedCostStore = new InMemoryCostStore();
  return sharedCostStore;
}

/** Test hook: swap the persistent spend backend without touching callers. */
export function __setCostStoreForTests(store: CostStore | null): void {
  sharedCostStore = store;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function utcMonth(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function userDailyKey(userId: string, day = utcDay()): string {
  return `cost:daily:${userId}:${day}`;
}

export function userMonthlyKey(userId: string, month = utcMonth()): string {
  return `cost:monthly:${userId}:${month}`;
}

export function globalDailyKey(day = utcDay()): string {
  return `cost:global:${day}`;
}

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
  private readonly persistent: Required<PersistentBudgetConfig>;
  private readonly requestCost: RequestCost = makeFreshCost();
  private readonly userCosts = new Map<string, UserCost>();
  private readonly jobCosts = new Map<string, JobCost>();
  private globalCost: GlobalCost = makeFreshGlobal();

  constructor(config: CostGovernorConfig & PersistentBudgetConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistent = {
      userDailyBudgetUsd: config.userDailyBudgetUsd ?? DEFAULT_PERSISTENT_BUDGETS.userDailyBudgetUsd,
      userMonthlyBudgetUsd: config.userMonthlyBudgetUsd ?? DEFAULT_PERSISTENT_BUDGETS.userMonthlyBudgetUsd,
      globalDailyBudgetUsd: config.globalDailyBudgetUsd ?? DEFAULT_PERSISTENT_BUDGETS.globalDailyBudgetUsd,
    };
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

  // -------------------------------------------------------------------------
  // Persistent spend (CostStore): pre-job gate + post-job recording.
  // -------------------------------------------------------------------------

  /**
   * Pre-job budget gate. Call BEFORE queueing: returns null when the user
   * and the platform both have budget headroom, otherwise a BUDGET_EXCEEDED
   * reason the route turns into a 402/429. Fails open when the store is
   * unreachable (cost control must never become an availability gate).
   */
  async canStartJob(userId: string): Promise<string | null> {
    if (!userId) return 'User id is required for budget check';
    let daily = 0;
    let monthly = 0;
    let global = 0;
    try {
      const store = getCostStore();
      [daily, monthly, global] = await Promise.all([
        store.get(userDailyKey(userId)),
        store.get(userMonthlyKey(userId)),
        store.get(globalDailyKey()),
      ]);
    } catch (err) {
      logger.warn('cost.spend_read_failed', 'Spend-store read failed (failing open)', {
        status: (err as Error)?.message || String(err),
      });
      return null;
    }
    if (daily >= this.persistent.userDailyBudgetUsd) {
      return `BUDGET_EXCEEDED: user daily budget $${this.persistent.userDailyBudgetUsd} reached (spent $${daily.toFixed(2)} today)`;
    }
    if (monthly >= this.persistent.userMonthlyBudgetUsd) {
      return `BUDGET_EXCEEDED: user monthly budget $${this.persistent.userMonthlyBudgetUsd} reached (spent $${monthly.toFixed(2)} this month)`;
    }
    if (global >= this.persistent.globalDailyBudgetUsd) {
      return `BUDGET_EXCEEDED: platform daily budget $${this.persistent.globalDailyBudgetUsd} reached — try again tomorrow`;
    }
    return null;
  }

  /**
   * Post-job recording. Adds costUsd atomically to the user-daily,
   * user-monthly and global-daily buckets (24h/31d TTLs). No-op for
   * non-positive costs. Store errors are logged, never thrown.
   */
  async recordJobCost(userId: string, jobId: string, costUsd: number): Promise<void> {
    void jobId;
    if (!userId || !(costUsd > 0)) return;
    try {
      const store = getCostStore();
      await Promise.all([
        store.add(userDailyKey(userId), costUsd, 24 * 3600),
        store.add(userMonthlyKey(userId), costUsd, 31 * 24 * 3600),
        store.add(globalDailyKey(), costUsd, 24 * 3600),
      ]);
    } catch (err) {
      logger.warn('cost.spend_write_failed', 'Spend-store write failed', {
        status: (err as Error)?.message || String(err),
      });
    }
  }

  /**
   * Cost breakdown for the authenticated user (powers the cost-breakdown
   * endpoint). Remaining budgets are clamped at zero.
   */
  async getUserCostBreakdown(userId: string): Promise<{
    today_usd: number;
    this_month_usd: number;
    daily_remaining: number;
    monthly_remaining: number;
  }> {
    const store = getCostStore();
    const [daily, monthly] = await Promise.all([
      store.get(userDailyKey(userId)),
      store.get(userMonthlyKey(userId)),
    ]);
    return {
      today_usd: daily,
      this_month_usd: monthly,
      daily_remaining: Math.max(0, this.persistent.userDailyBudgetUsd - daily),
      monthly_remaining: Math.max(0, this.persistent.userMonthlyBudgetUsd - monthly),
    };
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
