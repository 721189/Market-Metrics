import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { getAdminApp } from './firebase_admin.js';

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  next();
}

export function rateLimiterMiddleware(opts: any = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    next();
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
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
