import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { loadEnvironmentConfig } from './environment.js';

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
        console.log(
          `[Firebase Admin] Initialized for environment '${cfg.name}' (project: ${cfg.projectId})`,
        );
      } else {
        // No explicit project: fall back to Application Default Credentials.
        adminApp = initializeApp();
        console.log('[Firebase Admin] Initialized with default credentials');
      }
    } catch (err) {
      console.warn('[Firebase Admin] Initialization warning:', err);
      try {
        adminApp = getApp();
      } catch (e) {
        console.error('[Firebase Admin] Critical error: could not retrieve admin app instance.');
      }
    }
  }
  return adminApp;
}
