import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
// firebase-admin@14 uses the modular API: the v10 `app.auth()` accessor was
// removed. Auth must be obtained via getAuth(app). Importing it here (rather
// than the namespace default import) is what makes verifyIdToken available.
import { getAuth } from 'firebase-admin/auth';
import { getAdminApp } from './firebase_admin.js';
import { logger } from './logger.js';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebase-admin.js';

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

type IdempotencyRecord = {
  state: 'IN_FLIGHT' | 'COMPLETED';
  request_hash: string;
  lock_token?: string;
  status?: number;
  body?: any;
  expires_at_ms: number;
};

type IdempotencyDecision =
  | { kind: 'claimed'; lockToken: string }
  | { kind: 'replay'; status: number; body: any }
  | { kind: 'in_flight' }
  | { kind: 'conflict' };

const inMemoryIdempotencyCache = new Map<string, IdempotencyRecord>();
const IDEMPOTENCY_PENDING_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;

function stableJson(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(item => stableJson(item)).join(',') + ']';
  }
  const entries = Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + stableJson(value[key]),
  );
  return '{' + entries.join(',') + '}';
}

function idempotencyRequestHash(method: string, path: string, body: any): string {
  return crypto.createHash('sha256')
    .update(method + '\n' + path + '\n' + stableJson(body))
    .digest('hex');
}

function timestampMillis(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function sendIdempotencyError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): Response {
  if (retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
  }
  return res.status(status).json({ error: { code, message } });
}

function installIdempotencyResponse(
  req: Request,
  res: Response,
  next: NextFunction,
  options: {
    docKey: string;
    requestHash: string;
    lockToken: string;
    storeKind: 'memory' | 'firestore';
    firestoreRef?: DocumentReference;
  },
): void {
  const originalJson = res.json.bind(res);
  let responseFinalized = false;

  res.json = ((body: any) => {
    if (responseFinalized) return res;
    responseFinalized = true;

    const status = res.statusCode;
    const now = Date.now();
    const expiresAt = now + IDEMPOTENCY_RESPONSE_TTL_MS;

    if (options.storeKind === 'memory') {
      const current = inMemoryIdempotencyCache.get(options.docKey);
      if (!current || current.lock_token !== options.lockToken) {
        res.setHeader('Retry-After', '2');
        res.status(409);
        return originalJson({
          error: {
            code: 'IDEMPOTENCY_LEASE_LOST',
            message: 'This request no longer owns the idempotency reservation. Retry with the same key.',
          },
        });
      }
      inMemoryIdempotencyCache.set(options.docKey, {
        state: 'COMPLETED',
        request_hash: options.requestHash,
        lock_token: options.lockToken,
        status,
        body: body ?? null,
        expires_at_ms: expiresAt,
      });
      return originalJson(body);
    }

    // Do not let an expired handler overwrite a reservation acquired by a
    // later retry. The unique lock token is the fencing value for this claim.
    void adminDb.runTransaction(async transaction => {
      const ref = options.firestoreRef!;
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() as IdempotencyRecord | undefined;
      if (
        !snapshot.exists ||
        data?.state !== 'IN_FLIGHT' ||
        data.request_hash !== options.requestHash ||
        data.lock_token !== options.lockToken
      ) {
        return false;
      }
      transaction.update(ref, {
        state: 'COMPLETED',
        status,
        body: body ?? null,
        responded_at: FieldValue.serverTimestamp(),
        expires_at_ms: expiresAt,
        expires_at: new Date(expiresAt),
      });
      return true;
    }).then(committed => {
      if (!committed) {
        res.setHeader('Retry-After', '2');
        res.status(409);
        originalJson({
          error: {
            code: 'IDEMPOTENCY_LEASE_LOST',
            message: 'This request no longer owns the idempotency reservation. Retry with the same key.',
          },
        });
        return;
      }
      originalJson(body);
    }).catch(err => {
      logger.error('idempotency.persist_failed', 'Could not durably record an idempotent response', {
        user_id: (req as any).user?.uid,
        status: (err as Error)?.message || String(err),
      });
      if (!res.headersSent) {
        res.status(503);
        originalJson({
          error: {
            code: 'IDEMPOTENCY_STORE_UNAVAILABLE',
            message: 'The request result could not be safely persisted. Retry with the same idempotency key.',
          },
        });
      }
    });

    return res;
  }) as Response['json'];

  next();
}

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const rawKey = req.headers['x-idempotency-key'];
  if (rawKey === undefined) return next();
  if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.length > 200) {
    return sendIdempotencyError(
      res, 400, 'INVALID_IDEMPOTENCY_KEY',
      'X-Idempotency-Key must be a non-empty string of at most 200 characters.',
    );
  }

  const userId = (req as any).user?.uid;
  if (typeof userId !== 'string' || !userId) {
    return sendIdempotencyError(res, 401, 'UNAUTHORIZED', 'An authenticated user is required for idempotent requests.');
  }

  const idempotencyKey = rawKey.trim();
  const method = String(req.method || 'POST').toUpperCase();
  const path = String(req.originalUrl || req.path || '/').split('?')[0];
  const requestHash = idempotencyRequestHash(method, path, req.body ?? null);
  const docKey = crypto.createHash('sha256')
    .update(userId + '|' + method + '|' + path + '|' + idempotencyKey)
    .digest('hex');

  const productionDefaults = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
  const storeKind = (process.env.IDEMPOTENCY_STORE || (productionDefaults ? 'firestore' : 'memory')).trim().toLowerCase();
  if (storeKind !== 'memory' && storeKind !== 'firestore') {
    return sendIdempotencyError(
      res, 503, 'IDEMPOTENCY_STORE_UNAVAILABLE',
      'The configured idempotency store is not supported. Use memory or firestore.',
    );
  }

  const lockToken = crypto.randomUUID();

  if (storeKind === 'memory') {
    const now = Date.now();
    const existing = inMemoryIdempotencyCache.get(docKey);
    if (existing && existing.expires_at_ms > now) {
      if (existing.request_hash !== requestHash) {
        return sendIdempotencyError(
          res, 409, 'IDEMPOTENCY_KEY_REUSED',
          'This idempotency key was already used with a different request payload.',
        );
      }
      if (existing.state === 'COMPLETED') {
        return res.status(existing.status ?? 200).json(existing.body);
      }
      return sendIdempotencyError(
        res, 409, 'IDEMPOTENCY_IN_PROGRESS',
        'A request with this idempotency key is still in progress. Retry shortly.',
        2,
      );
    }

    inMemoryIdempotencyCache.set(docKey, {
      state: 'IN_FLIGHT',
      request_hash: requestHash,
      lock_token: lockToken,
      expires_at_ms: now + IDEMPOTENCY_PENDING_TTL_MS,
    });
    installIdempotencyResponse(req, res, next, {
      docKey, requestHash, lockToken, storeKind: 'memory',
    });
    return;
  }

  const ref = adminDb.collection('idempotency_keys').doc(docKey);
  const now = Date.now();
  void adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const data = snapshot.data() as (Partial<IdempotencyRecord> & {
        created_at?: any;
        createdAt?: any;
        created_at_ms?: number;
        responded_at?: any;
        respondedAt?: any;
        expires_at?: any;
      }) | undefined;

      const createdAt = timestampMillis(data?.created_at_ms) ??
        timestampMillis(data?.created_at) ??
        timestampMillis(data?.createdAt);
      const respondedAt = timestampMillis(data?.responded_at) ??
        timestampMillis(data?.respondedAt);
      const explicitExpiry = timestampMillis(data?.expires_at_ms) ??
        timestampMillis(data?.expires_at);

      const completed = data?.state === 'COMPLETED' ||
        (typeof data?.status === 'number' && data.body !== undefined);
      const recordExpiry = explicitExpiry ??
        (completed
          ? (respondedAt ?? createdAt ?? 0) + IDEMPOTENCY_RESPONSE_TTL_MS
          : (createdAt ?? 0) + IDEMPOTENCY_PENDING_TTL_MS);

      if (recordExpiry > now) {
        if (data?.request_hash && data.request_hash !== requestHash) {
          return { kind: 'conflict' } as IdempotencyDecision;
        }
        if (completed) {
          return {
            kind: 'replay',
            status: data?.status ?? 200,
            body: data?.body,
          } as IdempotencyDecision;
        }
        return { kind: 'in_flight' } as IdempotencyDecision;
      }
      // Expired or legacy records without trustworthy timestamps may be
      // reclaimed. A fresh unique token fences off the previous handler.
    }

    transaction.set(ref, {
      state: 'IN_FLIGHT',
      request_hash: requestHash,
      lock_token: lockToken,
      method,
      path,
      user_id: userId,
      key_hash: docKey,
      created_at: FieldValue.serverTimestamp(),
      created_at_ms: now,
      expires_at_ms: now + IDEMPOTENCY_PENDING_TTL_MS,
      expires_at: new Date(now + IDEMPOTENCY_PENDING_TTL_MS),
    });
    return { kind: 'claimed', lockToken } as IdempotencyDecision;
  }).then((decision: IdempotencyDecision) => {
    if (decision.kind === 'replay') {
      res.status(decision.status).json(decision.body);
      return;
    }
    if (decision.kind === 'conflict') {
      sendIdempotencyError(
        res, 409, 'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with a different request payload.',
      );
      return;
    }
    if (decision.kind === 'in_flight') {
      sendIdempotencyError(
        res, 409, 'IDEMPOTENCY_IN_PROGRESS',
        'A request with this idempotency key is still in progress. Retry shortly.',
        2,
      );
      return;
    }
    installIdempotencyResponse(req, res, next, {
      docKey,
      requestHash,
      lockToken: decision.lockToken,
      storeKind: 'firestore',
      firestoreRef: ref,
    });
  }).catch(err => {
    logger.error('idempotency.claim_failed', 'Could not safely claim idempotency key', {
      user_id: userId,
      status: (err as Error)?.message || String(err),
    });
    // Never execute the route when the durable guard is unavailable.
    sendIdempotencyError(
      res, 503, 'IDEMPOTENCY_STORE_UNAVAILABLE',
      'Request deduplication is temporarily unavailable. Retry with the same idempotency key.',
    );
  });
}



export function rateLimiterMiddleware(opts: { maxRequests?: number; windowSec?: number } = {}) {
  const maxRequests = opts.maxRequests || 120;
  const windowMs = (opts.windowSec || 60) * 1000;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    
    let record = rateLimitMap.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitMap.set(ip, record);
    } else {
      record.count++;
    }

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - record.count)));

    if (record.count > maxRequests) {
      return res.status(429).json({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' }
      });
    }

    next();
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // SSE /events route uses short-lived stream tickets instead of Bearer tokens,
  // because EventSource cannot send Authorization: Bearer headers. Skip
  // authMiddleware here; the route handler performs ticket-based auth.
  if (typeof req.path === 'string' && req.path.endsWith('/events')) {
    return next();
  }

  // Reject query token parameters explicitly for security
  if (req.query && (req.query.token || req.query.auth)) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Token in query parameters is forbidden for security reasons. Use Authorization: Bearer <token> header.' }
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required. No Bearer token provided.' }
    });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const adminApp = getAdminApp();
    if (adminApp) {
      const decodedToken = await getAuth(adminApp).verifyIdToken(token);
      (req as any).user = decodedToken;
      return next();
    } else {
      throw new Error('Firebase Admin not initialized');
    }
  } catch (err: any) {
    logger.warn('auth.verification_failed', 'Token verification failed', {
      status: err.message,
    });
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: `Token verification failed: ${err.message}` }
    });
  }
}

export function requireRole(allowedRoles: any[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    // Strict RBAC checks
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Role authorization failed' } });
    }
    next();
  };
}
