import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { getAdminApp } from './firebase_admin.js';

const idempotencyStore = new Map<string, { status: number; body: any; timestamp: number }>();
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const idempotencyKey = req.headers['x-idempotency-key'] as string;
  if (!idempotencyKey) {
    return next();
  }

  const cached = idempotencyStore.get(idempotencyKey);
  if (cached) {
    if (Date.now() - cached.timestamp < 24 * 3600 * 1000) {
      return res.status(cached.status).json(cached.body);
    } else {
      idempotencyStore.delete(idempotencyKey);
    }
  }

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    idempotencyStore.set(idempotencyKey, {
      status: res.statusCode,
      body,
      timestamp: Date.now(),
    });
    return originalJson(body);
  };

  next();
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
      const decodedToken = await adminApp.auth().verifyIdToken(token);
      (req as any).user = decodedToken;
      return next();
    } else {
      throw new Error('Firebase Admin not initialized');
    }
  } catch (err: any) {
    console.error('[Auth Middleware] Verification failed:', err.message);
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
