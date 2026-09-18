import { Request, Response, NextFunction } from 'express';

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
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAdminPath(req.path)) {
      return next();
    }

    const user = (req as any).user;
    const isAdmin = user?.role === 'admin' || user?.admin === true;

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
 * In production this should be backed by a distributed store (Redis /
 * Firestore), but this satisfies the correctness requirement that limits
 * are enforced by identity, not just by IP.
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

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
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const uid = (req as any).user?.uid || '';
    const category = classify(req);
    const budget = budgets[category] ?? DEFAULT_BUDGETS[category];

    const key = bucketKey(ip, uid, category);
    const now = Date.now();
    const windowMs = budget.windowSec * 1000;

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitStore.set(key, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, budget.maxRequests - record.count);

    res.setHeader('X-RateLimit-Limit', String(budget.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Category', category);
    res.setHeader('X-RateLimit-Scope', 'identity');

    if (record.count > budget.maxRequests) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests in this category. Please try again later.',
          category,
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
