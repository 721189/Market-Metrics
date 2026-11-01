/**
 * API Authentication & Security Middleware Tests
 * Verifies Bearer token extraction, query-parameter token blocking,
 * sliding-window rate limiting, and request idempotency caching.
 */

import { authMiddleware, rateLimiterMiddleware, idempotencyMiddleware } from '../server/middleware.js';

function createMockReqRes(overrides: {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  ip?: string;
  body?: any;
  userId?: string;
  method?: string;
  path?: string;
} = {}) {
  let statusCode = 200;
  let responseBody: any = null;
  const responseHeaders: Record<string, string> = {};

  const req: any = {
    headers: overrides.headers || {},
    query: overrides.query || {},
    ip: overrides.ip || '127.0.0.1',
    socket: { remoteAddress: overrides.ip || '127.0.0.1' },
    body: overrides.body ?? { question: 'test market research' },
    user: { uid: overrides.userId || 'usr_idempotency_test' },
    method: overrides.method || 'POST',
    path: overrides.path || '/api/v1/research',
    originalUrl: overrides.path || '/api/v1/research',
  };

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: any) {
      responseBody = body;
      return res;
    },
    setHeader(name: string, value: string) {
      responseHeaders[name] = value;
      return res;
    },
    get statusCode() {
      return statusCode;
    },
    get responseBody() {
      return responseBody;
    },
    get responseHeaders() {
      return responseHeaders;
    },
  };

  return { req, res };
}

export async function runApiAuthTest() {
  console.log('\n--- Running: API Auth & Security Middleware Test ---');

  // 1. Test missing Authorization header
  {
    const { req, res } = createMockReqRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });

    if (nextCalled || res.statusCode !== 401 || !res.responseBody?.error) {
      throw new Error(`Failed to reject missing auth header: code=${res.statusCode}`);
    }
    console.log('✓ Verified: Request without auth header is rejected with 401 UNAUTHORIZED.');
  }

  // 2. Test token passed in query parameter (MUST be rejected per security rule 24)
  {
    const { req, res } = createMockReqRes({
      headers: { authorization: 'Bearer valid-test-token' },
      query: { token: 'secret-leaked-in-query' },
    });
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });

    if (nextCalled || res.statusCode !== 401 || !res.responseBody?.error?.message?.includes('query parameters')) {
      throw new Error(`Failed to reject query token param: code=${res.statusCode}`);
    }
    console.log('✓ Verified: Token in query string parameter is explicitly blocked.');
  }

  // 3. Test malformed Authorization header (non-Bearer)
  {
    const { req, res } = createMockReqRes({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });

    if (nextCalled || res.statusCode !== 401) {
      throw new Error(`Failed to reject non-Bearer auth: code=${res.statusCode}`);
    }
    console.log('✓ Verified: Non-Bearer auth format rejected with 401.');
  }

  // 4. Test Rate Limiter Middleware
  {
    const limiter = rateLimiterMiddleware({ maxRequests: 3, windowSec: 10 });
    const ip = '198.51.100.42';

    // First 3 requests should succeed
    for (let i = 1; i <= 3; i++) {
      const { req, res } = createMockReqRes({ ip });
      let nextCalled = false;
      limiter(req, res, () => { nextCalled = true; });
      if (!nextCalled || res.statusCode === 429) {
        throw new Error(`Request ${i} under limit was improperly throttled`);
      }
    }

    // 4th request must be throttled with 429
    const { req: throttledReq, res: throttledRes } = createMockReqRes({ ip });
    let throttledNext = false;
    limiter(throttledReq, throttledRes, () => { throttledNext = true; });

    if (throttledNext || throttledRes.statusCode !== 429) {
      throw new Error(`Rate limit exceeded request was not throttled: code=${throttledRes.statusCode}`);
    }
    if (throttledRes.responseHeaders['X-RateLimit-Limit'] !== '3') {
      throw new Error('Missing X-RateLimit-Limit header');
    }
    console.log('✓ Verified: Rate limiter throttles excessive requests with 429 RATE_LIMIT_EXCEEDED and headers.');
  }

  // 5. Test Idempotency Middleware
  {
    const idempotencyKey = 'idem_key_payment_9988';
    let executionCounter = 0;

    // First call executes handler
    const { req: req1, res: res1 } = createMockReqRes({
      headers: { 'x-idempotency-key': idempotencyKey },
    });
    idempotencyMiddleware(req1, res1, () => {
      executionCounter++;
      res1.status(201).json({ id: 'job_created_001', executionCount: executionCounter });
    });

    if (executionCounter !== 1 || res1.statusCode !== 201) {
      throw new Error('First idempotent request failed to execute');
    }

    // Second call with same idempotency key should return cached response without re-executing
    const { req: req2, res: res2 } = createMockReqRes({
      headers: { 'x-idempotency-key': idempotencyKey },
    });
    idempotencyMiddleware(req2, res2, () => {
      executionCounter++;
      res2.status(201).json({ id: 'job_created_002', executionCount: executionCounter });
    });

    if (executionCounter !== 1) {
      throw new Error(`Idempotency violated: handler was executed twice! Count=${executionCounter}`);
    }
    if (res2.responseBody?.id !== 'job_created_001') {
      throw new Error(`Idempotency returned unexpected body: ${JSON.stringify(res2.responseBody)}`);
    }

    // Reusing a key for different input must not silently replay another request's result.
    const { req: mismatchReq, res: mismatchRes } = createMockReqRes({
      headers: { 'x-idempotency-key': idempotencyKey },
      body: { question: 'different request payload' },
    });
    let mismatchNext = false;
    idempotencyMiddleware(mismatchReq, mismatchRes, () => { mismatchNext = true; });
    if (mismatchNext || mismatchRes.statusCode !== 409 ||
        mismatchRes.responseBody?.error?.code !== 'IDEMPOTENCY_KEY_REUSED') {
      throw new Error('Reusing an idempotency key with a different payload must return 409.');
    }

    // The same key is scoped to the authenticated tenant; another user must
    // not receive or collide with the first user's replay record.
    const { req: otherTenantReq, res: otherTenantRes } = createMockReqRes({
      headers: { 'x-idempotency-key': idempotencyKey },
      userId: 'usr_other_tenant',
    });
    let otherTenantNext = false;
    idempotencyMiddleware(otherTenantReq, otherTenantRes, () => { otherTenantNext = true; });
    if (!otherTenantNext) {
      throw new Error('Idempotency cache keys must be isolated by authenticated user.');
    }
    otherTenantRes.status(201).json({ id: 'job_other_tenant' });

    // The same key and path can be used independently by a different HTTP
    // method. The request fingerprint already includes the method; the
    // reservation key must include it as well.
    const { req: deleteReq, res: deleteRes } = createMockReqRes({
      headers: { 'x-idempotency-key': idempotencyKey },
      method: 'DELETE',
    });
    let deleteNext = false;
    idempotencyMiddleware(deleteReq, deleteRes, () => { deleteNext = true; });
    if (
      deleteNext ||
      deleteRes.statusCode !== 409 ||
      deleteRes.responseBody?.error?.code !== 'IDEMPOTENCY_KEY_REUSED'
    ) {
      throw new Error('Reusing a key with a different HTTP method must be rejected as a request conflict.');
    }

    // Reserve a key before route execution so simultaneous duplicate requests
    // cannot both enter the handler.
    const inflightKey = 'idem_key_concurrent_1122';
    const { req: inflightReq1, res: inflightRes1 } = createMockReqRes({
      headers: { 'x-idempotency-key': inflightKey },
    });
    let firstInFlightExecution = 0;
    idempotencyMiddleware(inflightReq1, inflightRes1, () => { firstInFlightExecution++; });

    const { req: inflightReq2, res: inflightRes2 } = createMockReqRes({
      headers: { 'x-idempotency-key': inflightKey },
    });
    let secondInFlightExecution = 0;
    idempotencyMiddleware(inflightReq2, inflightRes2, () => { secondInFlightExecution++; });
    if (
      firstInFlightExecution !== 1 ||
      secondInFlightExecution !== 0 ||
      inflightRes2.statusCode !== 409 ||
      inflightRes2.responseBody?.error?.code !== 'IDEMPOTENCY_IN_PROGRESS'
    ) {
      throw new Error('Concurrent duplicate requests must not both execute the route.');
    }
    inflightRes1.status(201).json({ id: 'job_concurrent_001' });

    console.log('✓ Verified: Idempotency middleware caches identical mutation requests and prevents duplicate execution.');
  }

  console.log('✓ PASS: API Auth & Security Middleware tests passed.');
  return true;
}

if (process.argv[1]?.endsWith('api_auth.test.ts')) {
  runApiAuthTest().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
  });
}
