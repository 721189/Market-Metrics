import { Request, Response, NextFunction } from 'express';

/**
 * Cross-origin gate for the Vercel-frontend / Railway-backend split.
 * ---------------------------------------------------------------------------
 * Same-origin in dev (Vite middleware serves the SPA, CORS is a no-op).
 * In production the browser SPA lives on Vercel while this API lives on
 * Railway, so cross-origin must be explicitly allowed — but only for the
 * configured frontend origin(s), never `*` (requests carry Bearer tokens).
 *
 * FRONTEND_ORIGIN: comma-separated allowlist, e.g.
 *   https://market-metrics.vercel.app,https://metrics.example.com
 * Empty in dev = reflect localhost origins.
 */

function allowedOrigins(): string[] {
  const raw = (process.env.FRONTEND_ORIGIN || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isLocalhost(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function corsMiddleware() {
  const allowlist = allowedOrigins();
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    if (!origin) return next();

    const normalized = origin.toLowerCase();
    const allowed =
      allowlist.includes(normalized) ||
      (allowlist.length === 0 && isLocalhost(origin));

    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Idempotency-Key');
        res.setHeader('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origin not allowed' } });
    }

    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    return next();
  };
}
