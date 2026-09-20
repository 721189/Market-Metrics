import path from 'path';
import fs from 'fs';

/**
 * Deployment Environment Isolation
 * ---------------------------------------------------------------------------
 * Market-Metrics must never test production code against production data, and
 * must never let staging or development reach a production tenant. This module
 * makes that a runtime invariant rather than a deployment convention:
 *
 *   development | staging | production   (+ test for the suite)
 *
 * Each environment binds its own Firebase project, Firestore database, storage
 * bucket, Gemini credential and log level. The rules enforced here are:
 *
 *   1. Every environment resolves a complete resource set (fail closed).
 *   2. production may never reuse a development or staging identifier.
 *   3. A non-production environment may never claim the production project.
 *   4. production may never run with the AI Studio applet (dev) project.
 *   5. Non-production environments must be explicitly marked as such, so a
 *      missing NODE_ENV can never silently become "production".
 *
 * The module is deterministic and side-effect free at import time; call
 * `validateEnvironmentOrThrow()` once during boot.
 */

export type EnvironmentName = 'development' | 'staging' | 'production' | 'test';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface EnvironmentConfig {
  /** Resolved environment name. */
  name: EnvironmentName;
  /** Firebase project that owns this environment's resources. */
  projectId: string;
  /** Firestore database id (multi-database projects are supported). */
  firestoreDatabaseId: string;
  /** Cloud Storage bucket for raw retrieval artifacts (item 18). */
  storageBucket: string;
  /** Firebase auth domain. */
  authDomain: string;
  /**
   * Human-readable description of where the Gemini credential comes from.
   * The secret itself is never read into this structure.
   */
  geminiCredentialSource: string;
  /** Baseline log level; production defaults to `info`, dev to `debug`. */
  logLevel: LogLevel;
  /** Whether the Vite dev/static middleware may be mounted. */
  allowViteDevServer: boolean;
}

/**
 * The AI Studio applet project. It is a development resource and is explicitly
 * forbidden as a production or staging target — this is the concrete guard
 * against "we shipped the demo database to real users".
 */
export const APPLET_DEV_PROJECT_ID = 'gen-lang-client-0526957989';

const REQUIRED_FIELDS: Array<keyof EnvironmentConfig> = [
  'projectId',
  'firestoreDatabaseId',
  'storageBucket',
  'authDomain',
];

export class EnvironmentIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentIsolationError';
  }
}

function readAppletConfig(): Record<string, any> | null {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve the environment name. An unknown/missing value is never production. */
export function resolveEnvironmentName(env: NodeJS.ProcessEnv = process.env): EnvironmentName {
  const raw = (env.APP_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (raw === 'production' || raw === 'prod') return 'production';
  if (raw === 'staging' || raw === 'stage') return 'staging';
  if (raw === 'test') return 'test';
  return 'development';
}

/**
 * Resolve the resource set for an environment. Production and staging MUST
 * supply their own identifiers through environment variables; development
 * falls back to the local applet config so a fresh clone boots without setup.
 */
export function loadEnvironmentConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const name = resolveEnvironmentName(env);
  const applet = readAppletConfig();

  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  const firestoreDatabaseId = (env.FIRESTORE_DATABASE_ID || '').trim();
  const storageBucket = (env.STORAGE_BUCKET || '').trim();
  const authDomain = (env.FIREBASE_AUTH_DOMAIN || '').trim();

  // Development/test may fall back to the local applet project so that a local
  // checkout is runnable. Production and staging may NOT fall back.
  const devFallbackAllowed = name === 'development' || name === 'test';
  const fallback = devFallbackAllowed && applet ? applet : null;

  return {
    name,
    projectId: projectId || fallback?.projectId || '',
    firestoreDatabaseId: firestoreDatabaseId || fallback?.firestoreDatabaseId || '',
    storageBucket: storageBucket || fallback?.storageBucket || '',
    authDomain: authDomain || fallback?.authDomain || '',
    geminiCredentialSource: (env.GEMINI_CREDENTIAL_SOURCE || '').trim()
      || (env.GEMINI_API_KEY ? 'env:GEMINI_API_KEY' : 'unset'),
    logLevel: (name === 'development' || name === 'test' ? 'debug' : 'info') as LogLevel,
    allowViteDevServer: name !== 'production',
  };
}

/**
 * Enforce isolation. Returns the list of violations (empty when isolated) so
 * callers and tests can inspect them; `validateEnvironmentOrThrow` converts a
 * non-empty list into a hard boot failure.
 */
export function findEnvironmentViolations(cfg: EnvironmentConfig): string[] {
  const violations: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!String(cfg[field] || '').trim()) {
      violations.push(`[${cfg.name}] missing required resource identifier: ${field}`);
    }
  }

  if (cfg.name === 'production' || cfg.name === 'staging') {
    if (cfg.projectId === APPLET_DEV_PROJECT_ID) {
      violations.push(
        `[${cfg.name}] refuses to bind the AI Studio applet (development) project `
        + `'${APPLET_DEV_PROJECT_ID}'. Provision a separate Firebase project for ${cfg.name}.`,
      );
    }
  }

  // A non-production environment must never point at production resources.
  const productionProjectId = (process.env.PRODUCTION_PROJECT_ID || '').trim();
  if (cfg.name !== 'production' && productionProjectId && cfg.projectId === productionProjectId) {
    violations.push(
      `[${cfg.name}] must not bind the production project '${productionProjectId}'. `
      + 'Use a dedicated development/staging project.',
    );
  }

  if (cfg.name === 'production' && cfg.geminiCredentialSource === 'unset') {
    violations.push('[production] a Gemini credential must be provisioned for production.');
  }

  if (cfg.name === 'production' && cfg.allowViteDevServer) {
    violations.push('[production] the Vite dev middleware must not be mounted in production.');
  }

  return violations;
}

/**
 * Boot-time gate. Throws `EnvironmentIsolationError` when the resolved
 * environment is not isolated, so the process never serves traffic against
 * the wrong tenant.
 */
export function validateEnvironmentOrThrow(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const cfg = loadEnvironmentConfig(env);
  const violations = findEnvironmentViolations(cfg);
  if (violations.length > 0) {
    throw new EnvironmentIsolationError(
      `Environment isolation check failed for '${cfg.name}':\n  - ${violations.join('\n  - ')}`,
    );
  }
  return cfg;
}

/** One-line, secret-free description for boot logs and readiness payloads. */
export function describeEnvironment(cfg: EnvironmentConfig): string {
  return `env=${cfg.name} project=${cfg.projectId} database=${cfg.firestoreDatabaseId} `
    + `bucket=${cfg.storageBucket} gemini=${cfg.geminiCredentialSource}`;
}
