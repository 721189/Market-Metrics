/**
 * Owner-keyed report cache (Phase 4 of the deploy plan).
 * ---------------------------------------------------------------------------
 * Every report read goes through here. Cache key includes the owner UID, so
 * cross-tenant isolation holds even on a hit. Completed reports cache for
 * one hour; RUNNING jobs are never cached (callers only cache finished
 * reports — enforced by only caching non-null reports fetched after
 * completion, and by explicit invalidation below).
 *
 * Backed by the CacheStore interface (in-memory default; Redis later).
 */

import { DatabaseRepository } from './db.js';
import type { FullResearchReport } from '../types.js';
import {
  InMemoryCacheStore,
  resolveStoreKind,
  throwRedisNotProvisioned,
  type CacheStore,
} from './stores.js';

const REPORT_CACHE_TTL_SEC = 3600;

let cacheStore: CacheStore | null = null;

function getCacheStore(): CacheStore {
  if (cacheStore) return cacheStore;
  const kind = resolveStoreKind(process.env.CACHE_STORE, 'memory');
  if (kind === 'redis') throwRedisNotProvisioned('CacheLayer');
  if (kind === 'firestore') {
    throw new Error(
      '[CacheLayer] CACHE_STORE=firestore selected but no Firestore cache store ' +
        'is provisioned. Use memory (single replica).',
    );
  }
  cacheStore = new InMemoryCacheStore();
  return cacheStore;
}

/** Test hook: swap the backing store without touching callers. */
export function __setCacheStoreForTests(store: CacheStore | null): void {
  cacheStore = store;
}

function cacheKey(userId: string, jobId: string): string {
  return `report:${userId}:${jobId}`;
}

export class CacheLayer {
  static async getReportCached(
    jobId: string,
    userId: string,
  ): Promise<FullResearchReport | null> {
    if (!userId) throw new Error('[Cache] userId is required for getReportCached');
    const store = getCacheStore();
    const key = cacheKey(userId, jobId);

    let cached: string | null = null;
    try {
      cached = await store.get(key);
    } catch (err) {
      // Fail open to the database: a cache outage must never 404 a report.
      cached = null;
    }
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as FullResearchReport;
        // Paranoia: a cached entry must belong to the requesting owner.
        if (parsed && (parsed as { user_id?: string }).user_id !== userId) {
          await store.del(key).catch(() => undefined);
        } else {
          return parsed;
        }
      } catch {
        await store.del(key).catch(() => undefined);
      }
    }

    const report = await DatabaseRepository.getReport(jobId, userId);
    if (report) {
      await store.set(key, JSON.stringify(report), REPORT_CACHE_TTL_SEC).catch(() => undefined);
    }
    return report;
  }

  /**
   * Invalidate after state transitions that change report content —
   * currently job COMPLETED (new report written) and job deletion.
   */
  static async invalidateReportCache(jobId: string, userId: string): Promise<void> {
    await getCacheStore().del(cacheKey(userId, jobId)).catch(() => undefined);
  }
}
