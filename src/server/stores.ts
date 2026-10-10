import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
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

// ---------------------------------------------------------------------------
// Firestore-backed stores (multi-replica; selected via COST_STORE /
// RATE_LIMIT_STORE = firestore)
// ---------------------------------------------------------------------------

const COST_COLLECTION = 'cost_buckets';
const RATE_LIMIT_COLLECTION = 'rate_limit_buckets';

/**
 * Firestore-backed CostStore.
 *
 * Uses atomic FieldValue.increment on per-key documents so that concurrent
 * replicas can accumulate cost without read-modify-write races. Each bucket
 * is a document whose only field is `total_usd` (a floating-point number).
 *
 * Keys follow the same naming convention as InMemoryCostStore so that the
 * same bucket name works regardless of backend:
 *   cost:daily:{userId}:{yyyy-mm-dd}
 *   cost:monthly:{userId}:{yyyy-mm}
 *   cost:global:{yyyy-mm-dd}
 */
export class FirestoreCostStore implements CostStore {
  readonly kind = 'firestore';

  async add(key: string, costUsd: number, ttlSec: number): Promise<number> {
    // ttlSec is accepted for interface parity but Firestore documents are
    // not TTL-managed here — bucket keys embed the day/month so old buckets
    // naturally stop receiving writes. A cleanup job (not implemented here)
    // can delete stale docs.
    const ref = adminDb.collection(COST_COLLECTION).doc(key);
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data()?.total_usd ?? 0) : 0;
      tx.set(ref, { total_usd: existing + costUsd, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    });
    // Read back the new total. In the common case the increment is atomic and
    // this read is consistent; under extreme contention the read may lag by
    // one increment, which is acceptable for cost accounting (never under-
    // charges a user, and the per-request budget gate uses a separate pre-
    // check + allow path).
    const after = await adminDb.collection(COST_COLLECTION).doc(key).get();
    return (after.data()?.total_usd ?? 0);
  }

  async get(key: string): Promise<number> {
    const snap = await adminDb.collection(COST_COLLECTION).doc(key).get();
    return snap.exists ? (snap.data()?.total_usd ?? 0) : 0;
  }
}

/**
 * Firestore-backed RateLimitStore.
 *
 * One document per bucket key. The document holds `{ count, resetAt }` and
 * every `hit` call runs a transaction that resets the bucket when the window
 * has expired, otherwise increments. This is atomic across replicas.
 *
 * Window expiry is determined by the stored `resetAt` timestamp, not by the
 * caller-supplied windowSec on every hit — the windowSec is only used when
 * creating a fresh bucket. This avoids clock-skew races where two replicas
 * disagree on window boundaries.
 */
export class FirestoreRateLimitStore implements RateLimitStore {
  readonly kind = 'firestore';

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitVerdict> {
    const ref = adminDb.collection(RATE_LIMIT_COLLECTION).doc(key);
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      let count: number;
      let resetAt: number;

      if (!snap.exists) {
        // Fresh bucket.
        count = 1;
        resetAt = now + windowSec * 1000;
      } else {
        const data = snap.data() as { count?: number; resetAt?: number } | undefined;
        const storedResetAt = data?.resetAt;
        if (!storedResetAt || now >= storedResetAt) {
          // Window expired — reset.
          count = 1;
          resetAt = now + windowSec * 1000;
        } else {
          count = (data?.count ?? 0) + 1;
          resetAt = storedResetAt;
        }
      }

      tx.set(ref, { count, resetAt, updated_at: FieldValue.serverTimestamp() }, { merge: true });

      const remaining = Math.max(0, limit - count);
      const resetAfterSec = Math.max(0, Math.ceil((resetAt - now) / 1000));
      return {
        count,
        limit,
        remaining,
        resetAfterSec,
        limited: count > limit,
      };
    });
  }
}


const CACHE_COLLECTION = 'cache_buckets';

export class FirestoreCacheStore implements CacheStore {
  readonly kind = 'firestore';

  async get(key: string): Promise<string | null> {
    const snap = await adminDb.collection(CACHE_COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (data?.expiresAt && Date.now() >= data.expiresAt) {
      await this.del(key).catch(() => {});
      return null;
    }
    return data?.value || null;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await adminDb.collection(CACHE_COLLECTION).doc(key).set({
      value,
      expiresAt: Date.now() + ttlSec * 1000,
      updated_at: FieldValue.serverTimestamp()
    });
  }

  async del(key: string): Promise<void> {
    await adminDb.collection(CACHE_COLLECTION).doc(key).delete();
  }
}
