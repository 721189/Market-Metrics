/**
 * Deploy-layer test suite (part 1): harness + CORS gate checks.
 * ---------------------------------------------------------------------------
 * The main integration suite proves the research pipeline; this suite proves
 * the Vercel/Railway split pieces: cross-origin allow/deny, fail-open and
 * fail-closed store behavior, BUDGET_EXCEEDED before queueing, spend
 * recording, and owner-keyed cache hit/miss/invalidation/isolation.
 */

import { corsMiddleware } from '../server/cors.js';

export type Check = { name: string; fn: () => Promise<boolean> | boolean };

export function mockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    headers,
    statusCode: 200,
    body: undefined as any,
    ended: false,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status: (code: number) => { res.statusCode = code; return res; },
    json: (b: any) => { res.body = b; return res; },
    end: () => { res.ended = true; return res; },
  };
  return res;
}

export function mockReq(over: Record<string, any> = {}): any {
  return { method: 'GET', path: '/', ip: '1.2.3.4', headers: {}, socket: {}, ...over };
}

export async function runMiddleware(mw: any, req: any, res: any): Promise<boolean> {
  let nexted = false;
  const maybe = mw(req, res, () => { nexted = true; });
  if (maybe && typeof maybe.then === 'function') await maybe;
  return nexted;
}

export const corsChecks: Check[] = [
  {
    name: 'CORS allows the configured FRONTEND_ORIGIN',
    fn: async () => {
      process.env.FRONTEND_ORIGIN = 'https://market-metrics.vercel.app';
      const mw = corsMiddleware();
      const req = mockReq({ method: 'GET', headers: { origin: 'https://market-metrics.vercel.app' } });
      const res = mockRes();
      const nexted = await runMiddleware(mw, req, res);
      delete process.env.FRONTEND_ORIGIN;
      return nexted && res.headers['Access-Control-Allow-Origin'] === 'https://market-metrics.vercel.app';
    },
  },
  {
    name: 'CORS preflight from an unknown origin is rejected',
    fn: async () => {
      process.env.FRONTEND_ORIGIN = 'https://market-metrics.vercel.app';
      const mw = corsMiddleware();
      const req = mockReq({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
      const res = mockRes();
      await runMiddleware(mw, req, res);
      delete process.env.FRONTEND_ORIGIN;
      return res.statusCode === 403;
    },
  },
  {
    name: 'CORS reflects localhost origins in dev (no allowlist)',
    fn: async () => {
      delete process.env.FRONTEND_ORIGIN;
      const mw = corsMiddleware();
      const req = mockReq({ method: 'GET', headers: { origin: 'http://localhost:5173' } });
      const res = mockRes();
      const nexted = await runMiddleware(mw, req, res);
      return nexted && res.headers['Access-Control-Allow-Origin'] === 'http://localhost:5173';
    },
  },
];
