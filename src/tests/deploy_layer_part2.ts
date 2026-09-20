/**
 * Deploy-layer checks (part 2): rate limiter backend + persistent budgets.
 */

import { __setRateLimitStoreForTests, rateLimiterByCategory } from '../server/rate_limits.js';
import { CostGovernor, __setCostStoreForTests } from '../server/cost_governor.js';
import { InMemoryCostStore, InMemoryRateLimitStore } from '../server/stores.js';
import { mockReq, mockRes, runMiddleware, type Check } from './deploy_layer.test.js';

export const limiterBudgetChecks: Check[] = [
  {
    name: 'rate limiter enforces category budgets and stamps retry_after',
    fn: async () => {
      __setRateLimitStoreForTests(new InMemoryRateLimitStore());
      const mw = rateLimiterByCategory(
        { default: { category: 'default', maxRequests: 2, windowSec: 60 } },
        () => 'default' as any,
      );
      const req = mockReq({ path: '/api/v1/research/x' });
      const r1 = mockRes();
      const r2 = mockRes();
      const r3 = mockRes();
      const n1 = await runMiddleware(mw, req, r1);
      const n2 = await runMiddleware(mw, req, r2);
      const n3 = await runMiddleware(mw, req, r3);
      __setRateLimitStoreForTests(null);
      return (
        n1 && n2 && !n3 &&
        r3.statusCode === 429 &&
        r3.body?.error?.code === 'RATE_LIMIT_EXCEEDED' &&
        typeof r3.body?.error?.retry_after === 'number'
      );
    },
  },
  {
    name: 'rate limiter fails open when the store throws',
    fn: async () => {
      const broken = {
        kind: 'broken',
        hit: async () => { throw new Error('store down'); },
      };
      __setRateLimitStoreForTests(broken as any);
      const mw = rateLimiterByCategory({}, () => 'default' as any);
      const nexted = await runMiddleware(mw, mockReq({ path: '/x' }), mockRes());
      __setRateLimitStoreForTests(null);
      return nexted === true;
    },
  },
  {
    name: 'canStartJob allows a fresh user and records spend atomically',
    fn: async () => {
      __setCostStoreForTests(new InMemoryCostStore());
      const gov = new CostGovernor({ userDailyBudgetUsd: 10, userMonthlyBudgetUsd: 100, globalDailyBudgetUsd: 500 });
      const before = await gov.canStartJob('usr-fresh');
      if (before !== null) return false;
      await gov.recordJobCost('usr-fresh', 'job-1', 4);
      const after = await gov.canStartJob('usr-fresh');
      const breakdown = await gov.getUserCostBreakdown('usr-fresh');
      __setCostStoreForTests(null);
      return (
        after === null &&
        Math.abs(breakdown.today_usd - 4) < 1e-9 &&
        Math.abs(breakdown.this_month_usd - 4) < 1e-9 &&
        Math.abs(breakdown.daily_remaining - 6) < 1e-9
      );
    },
  },
  {
    name: 'canStartJob returns BUDGET_EXCEEDED once the daily budget is hit',
    fn: async () => {
      __setCostStoreForTests(new InMemoryCostStore());
      const gov = new CostGovernor({ userDailyBudgetUsd: 5, userMonthlyBudgetUsd: 100, globalDailyBudgetUsd: 500 });
      await gov.recordJobCost('usr-capped', 'job-1', 3);
      await gov.recordJobCost('usr-capped', 'job-2', 2.5);
      const verdict = await gov.canStartJob('usr-capped');
      __setCostStoreForTests(null);
      return typeof verdict === 'string' && verdict.startsWith('BUDGET_EXCEEDED');
    },
  },
  {
    name: 'parallel job completions never lose cost (atomic add)',
    fn: async () => {
      __setCostStoreForTests(new InMemoryCostStore());
      const gov = new CostGovernor({ userDailyBudgetUsd: 1000, userMonthlyBudgetUsd: 10000, globalDailyBudgetUsd: 100000 });
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => gov.recordJobCost('usr-race', `job-${i}`, 1)),
      );
      const breakdown = await gov.getUserCostBreakdown('usr-race');
      __setCostStoreForTests(null);
      return Math.abs(breakdown.today_usd - 20) < 1e-9;
    },
  },
];
