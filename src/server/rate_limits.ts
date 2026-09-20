import { Request, Response, NextFunction } from 'express';
import {
  InMemoryRateLimitStore,
  resolveStoreKind,
  throwRedisNotProvisioned,
  type RateLimitStore,
} from './stores.js';
import { logger } from './logger.js';

/**
 * Server-side administrative path lockdown.
 *
 * Any request whose path starts with one of these prefixes is rejected
 * unless it is an explicitly allow-listed admin endpoint that enforces its
 * own authorization. Frontend visibility is irrelevant; authorization is
 * enforced here on every request.
 */
const ADMIN_PREFIXES = [
  '/system',
  '/admin',
  '/metrics',
  '/errors',
  '/backup',
  '/restore',
];

/**
 * Normalized prefix match: handles "/admin", "/admin/", "/admin/foo"
 * without matching "/administration".
 */
function isAdminPath(path: string): boolean {
  const normalized = path.split('?')[0].toLowerCase();
  for (const prefix of ADMIN_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(prefix + '/')) {
      return true;
    }
  }
  return false;
}

export function adminPathBlocker() {
  // ADMIN_UIDS: comma-separated Firebase UIDs allowed to touch admin paths.
  // Parsed per request (cheap) so Railway env-var changes take effect on
  // redeploy without a code change. Empty = nobody is admin (fail closed).
  const adminUids = (): Set<string> =>
    new Set(
      (process.env.ADMIN_UIDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAdminPath(req.path)) {
      return next();
    }

    const user = (req as any).user;
    const uid: string | undefined = user?.uid;
    const isAdmin =
      (!!uid && adminUids().has(uid)) || user?.role === 'admin' || user?.admin === true;

    if (!user || !isAdmin) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Not found' },
      });
    }

    return next();
  };
}

export type RateLimitCategory =
  | 'research_creation'
  | 'report_read'
  | 'export'
  | 'admin'
  | 'authentication'
  | 'default';

export interface CategoryBudget {
  category: RateLimitCategory;
  maxRequests: number;
  windowSec: number;
}

const DEFAULT_BUDGETS: Record<RateLimitCategory, CategoryBudget> = {
  research_creation: { category: 'research_creation', maxRequests: 10, windowSec: 60 },
  report_read: { category: 'report_read', maxRequests: 120, windowSec: 60 },
  export: { category: 'export', maxRequests: 20, windowSec: 60 },
  admin: { category: 'admin', maxRequests: 30, windowSec: 60 },
  authentication: { category: 'authentication', maxRequests: 20, windowSec: 60 },
  default: { category: 'default', maxRequests: 120, windowSec: 60 },
};

/**
 * In-memory rate-limit store keyed by IP + Firebase UID + category.
 *
 * Single-replica default. Multi-replica without Redis uses the Firestore
 * store (selected via RATE_LIMIT_STORE=firestore); Redis slots in later
 * behind the same RateLimitStore interface with zero middleware changes.
 */
let rateLimitStore: RateLimitStore | null = null;

function getRateLimitStore(): RateLimitStore {
  if (rateLimitStore) return rateLimitStore;
  const kind = resolveStoreKind(process.env.RATE_LIMIT_STORE, 'memory');
  // Firestore-backed buckets land here when replicas>1 (atomic increment
  // docs); for now the only provisioned backend is the in-memory one.
  if (kind === 'redis') throwRedisNotProvisioned('rateLimiterByCategory');
  if (kind === 'firestore') {
    throw new Error(
      '[rateLimiterByCategory] RATE_LIMIT_STORE=firestore selected but the ' +
        'Firestore bucket store is not wired yet. Use memory (single replica).',
    );
  }
  rateLimitStore = new InMemoryRateLimitStore();
  return rateLimitStore;
}

/** Test hook: swap the backing store without touching middleware. */
export function __setRateLimitStoreForTests(store: RateLimitStore | null): void {
  rateLimitStore = store;
}

function bucketKey(ip: string, uid: string, category: RateLimitCategory): string {
  return `${category}::${uid || 'anonymous'}::${ip}`;
}

function defaultCategoryClassifier(req: Request): RateLimitCategory {
  const method = req.method.toUpperCase();
  const path = req.path.toLowerCase();

  if (path.startsWith('/api/v1/research') && method === 'POST') {
    return 'research_creation';
  }

  if (path.startsWith('/api/v1/research') && method === 'GET') {
    return 'report_read';
  }

  if (path.includes('/export/') || path.endsWith('/export/csv') || path.endsWith('/export/pdf')) {
    return 'export';
  }

  if (path.startsWith('/api/v1/auth') || path.startsWith('/auth')) {
    return 'authentication';
  }

  if (isAdminPath(path)) {
    return 'admin';
  }

  return 'default';
}

export function rateLimiterByCategory(
  budgets: Partial<Record<RateLimitCategory, CategoryBudget>> = {},
  classify: (req: Request) => RateLimitCategory = defaultCategoryClassifier,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const uid = (req as any).user?.uid || '';
    const category = classify(req);
    const budget = budgets[category] ?? DEFAULT_BUDGETS[category];

    const key = bucketKey(ip, uid, category);

    // Fail open: if the store is down/misconfigured, never block traffic —
    // rate limiting is a cost control, not an availability gate.
    let verdict;
    try {
      verdict = await getRateLimitStore().hit(key, budget.maxRequests, budget.windowSec);
    } catch (err) {
      logger.warn('ratelimit.store_error', 'Rate-limit store error (failing open)', {
        status: (err as Error)?.message || String(err),
      });
      return next();
    }

    res.setHeader('X-RateLimit-Limit', String(budget.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
    res.setHeader('X-RateLimit-Category', category);
    res.setHeader('X-RateLimit-Scope', 'identity');
    res.setHeader('X-RateLimit-Store', getRateLimitStore().kind);

    if (verdict.limited) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests in this category. Please try again later.',
          category,
          retry_after: verdict.resetAfterSec,
        },
      });
    }

    next();
  };
}

export interface LogEnvelope {
  request_id?: string;
  user_id?: string;
  job_id?: string;
  stage?: string;
  status?: string;
  duration_ms?: number;
}

export function logEnvelope(event: string, envelope: LogEnvelope, message: string): void {
  const line = {
    event,
    timestamp: new Date().toISOString(),
    ...envelope,
    message,
  };
  console.log(JSON.stringify(line));
}
