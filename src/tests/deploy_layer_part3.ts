/**
 * Deploy-layer checks (part 3): owner-keyed report cache + runner.
 */

import { CacheLayer, __setCacheStoreForTests } from '../server/cache.js';
import { __setCostStoreForTests } from '../server/cost_governor.js';
import { __setRateLimitStoreForTests } from '../server/rate_limits.js';
import { InMemoryCacheStore, type CacheStore } from '../server/stores.js';
import { corsChecks } from './deploy_layer.test.js';
import { limiterBudgetChecks } from './deploy_layer_part2.js';
import type { Check } from './deploy_layer.test.js';

const cacheChecks: Check[] = [
  {
    name: 'cache misses to the DB, then serves the cached copy',
    fn: async () => {
      const backing: CacheStore = new InMemoryCacheStore();
      __setCacheStoreForTests(backing);
      const db = await import('../server/db.js');
      const orig = (db.DatabaseRepository as any).getReport;
      let calls = 0;
      (db.DatabaseRepository as any).getReport = async (jobId: string, userId: string) => {
        calls++;
        return { job_id: jobId, user_id: userId, title: 'cached dossier' } as any;
      };
      const first = await CacheLayer.getReportCached('job-cache-1', 'usr-a');
      const second = await CacheLayer.getReportCached('job-cache-1', 'usr-a');
      (db.DatabaseRepository as any).getReport = orig;
      __setCacheStoreForTests(null);
      return calls === 1 && (first as any)?.title === 'cached dossier' && (second as any)?.title === 'cached dossier';
    },
  },
  {
    name: 'cached entries are isolated per owner (cross-user miss)',
    fn: async () => {
      const backing: CacheStore = new InMemoryCacheStore();
      __setCacheStoreForTests(backing);
      const db = await import('../server/db.js');
      const orig = (db.DatabaseRepository as any).getReport;
      let calls = 0;
      (db.DatabaseRepository as any).getReport = async (jobId: string, userId: string) => {
        calls++;
        return { job_id: jobId, user_id: userId, title: `dossier-for-${userId}` } as any;
      };
      await CacheLayer.getReportCached('job-shared', 'usr-a');
      const other = await CacheLayer.getReportCached('job-shared', 'usr-b');
      (db.DatabaseRepository as any).getReport = orig;
      __setCacheStoreForTests(null);
      return calls === 2 && (other as any)?.title === 'dossier-for-usr-b';
    },
  },
  {
    name: 'invalidation drops the stale copy after completion',
    fn: async () => {
      const backing: CacheStore = new InMemoryCacheStore();
      __setCacheStoreForTests(backing);
      const db = await import('../server/db.js');
      const orig = (db.DatabaseRepository as any).getReport;
      let version = 1;
      (db.DatabaseRepository as any).getReport = async (jobId: string, userId: string) => {
        return { job_id: jobId, user_id: userId, title: `v${version}` } as any;
      };
      await CacheLayer.getReportCached('job-inv', 'usr-a');
      version = 2;
      await CacheLayer.invalidateReportCache('job-inv', 'usr-a');
      const fresh = await CacheLayer.getReportCached('job-inv', 'usr-a');
      (db.DatabaseRepository as any).getReport = orig;
      __setCacheStoreForTests(null);
      return (fresh as any)?.title === 'v2';
    },
  },
];

export async function runDeployLayerTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Deploy-Layer Test (CORS, stores, budgets, cache) ---');
  const all = [...corsChecks, ...limiterBudgetChecks, ...cacheChecks];
  for (const check of all) {
    try {
      const ok = await check.fn();
      if (!ok) throw new Error('assertion returned false');
      console.log(`✔ ${check.name}`);
    } catch (err: any) {
      const message = `${check.name}: ${err?.message || String(err)}`;
      console.log(`✘ ${message}`);
      return { passed: false, message };
    } finally {
      delete process.env.FRONTEND_ORIGIN;
      delete process.env.RATE_LIMIT_STORE;
      __setCostStoreForTests(null);
      __setRateLimitStoreForTests(null);
      __setCacheStoreForTests(null);
    }
  }
  console.log(`✔ Deploy-layer suite passed (${all.length} invariants).`);
  return { passed: true, message: 'Deploy-layer suite passed.' };
}
