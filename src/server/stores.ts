/**
 * Pluggable backing stores for rate limiting, cost accounting and caching.
 * ---------------------------------------------------------------------------
 * Today everything runs on in-memory defaults (single Railway replica). When
 * replicas>1 justifies Redis, add Redis*Store implementations behind these
 * exact interfaces — middleware, governors and caches never change.
 *
 * Selection is env-driven (RATE_LIMIT_STORE / COST_STORE / CACHE_STORE):
 *   memory     in-process Map (default; tests + single replica)
 *   firestore  atomic FieldValue.increment buckets (multi-replica, no Redis)
 *   redis      reserved for later; selecting it now throws a clear error
 *              telling the operator it is not provisioned yet.
 */

export interface RateLimitVerdict {
  count: number;
  limit: number;
  remaining: number;
  resetAfterSec: number;
  limited: boolean;
}

export interface RateLimitStore {
  readonly kind: string;
  /**
   * Atomically increment the bucket and return the post-increment verdict.
   * Implementations MUST be atomic (no check-then-act race).
   */
  hit(key: string, limit: number, windowSec: number): Promise<RateLimitVerdict>;
}

export interface CostStore {
  readonly kind: string;
  /** Atomically add costUsd to the bucket and return the new total. */
  add(key: string, costUsd: number, ttlSec: number): Promise<number>;
  /** Read the current bucket total (0 when absent). */
  get(key: string): Promise<number>;
}

export interface CacheStore {
  readonly kind: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

export type StoreKind = 'memory' | 'firestore' | 'redis';

/** Parse a store selector env var; unknown values fail closed to memory. */
export function resolveStoreKind(raw: string | undefined, fallback: StoreKind = 'memory'): StoreKind {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'memory' || v === 'firestore' || v === 'redis') return v;
  return fallback;
}

/** Redis is a deliberate later step — refuse loudly instead of half-working. */
export function throwRedisNotProvisioned(which: string): never {
  throw new Error(
    `[${which}] RATE_*_STORE=redis selected but Redis is not provisioned yet ` +
      '(decision: Redis later). Use memory (single replica) or firestore ' +
      '(multi-replica without Redis).',
  );
}

// ---------------------------------------------------------------------------
// In-memory implementations (default; single replica + tests)
// ---------------------------------------------------------------------------

export class InMemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memory';
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitVerdict> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowSec * 1000 };
      this.buckets.set(key, bucket);
    } else {
      bucket.count += 1;
    }
    const resetAfterSec = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      count: bucket.count,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAfterSec,
      limited: bucket.count > limit,
    };
  }
}

export class InMemoryCostStore implements CostStore {
  readonly kind = 'memory';
  private readonly totals = new Map<string, number>();

  async add(key: string, costUsd: number): Promise<number> {
    const next = (this.totals.get(key) || 0) + costUsd;
    this.totals.set(key, next);
    return next;
  }

  async get(key: string): Promise<number> {
    return this.totals.get(key) || 0;
  }
}

export class InMemoryCacheStore implements CacheStore {
  readonly kind = 'memory';
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
