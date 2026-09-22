import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { loadEnvironmentConfig } from './environment.js';
import { logger } from './logger.js';

let adminApp: any = null;

/**
 * Returns the Firebase Admin app for the CURRENT deployment environment.
 *
 * Isolation guarantee: this binds the project resolved by
 * `loadEnvironmentConfig()` — i.e. `FIREBASE_PROJECT_ID` for staging/
 * production, and the local applet project only for development/test. It
 * deliberately no longer reads `firebase-applet-config.json` directly, because
 * doing so meant staging and production would silently attach to the AI Studio
 * development project instead of their own tenant.
 */
export function getAdminApp(): any {
  if (!adminApp) {
    try {
      if (getApps().length > 0) {
        adminApp = getApp();
        return adminApp;
      }

      const cfg = loadEnvironmentConfig();
      if (cfg.projectId) {
        adminApp = initializeApp({ projectId: cfg.projectId });
        logger.info('firebase.admin_init', `Initialized for environment '${cfg.name}'`, {
          status: `project: ${cfg.projectId}`,
        });
      } else {
        // No explicit project: fall back to Application Default Credentials.
        adminApp = initializeApp();
        logger.info('firebase.admin_init_default', 'Initialized with default credentials');
      }
    } catch (err) {
      logger.warn('firebase.admin_init_warning', 'Initialization warning', {
        status: (err as Error)?.message || String(err),
      });
      try {
        adminApp = getApp();
      } catch (e) {
        logger.error('firebase.admin_init_critical', 'Could not retrieve admin app instance', {
          status: (e as Error)?.message || String(e),
        });
      }
    }
  }
  return adminApp;
}
