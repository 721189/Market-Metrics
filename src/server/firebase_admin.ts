import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

let adminApp: any = null;

export function getAdminApp(): any {
  if (!adminApp) {
    try {
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        adminApp = admin.initializeApp({
          projectId: config.projectId,
        });
        console.log('[Firebase Admin] Initialized with project ID:', config.projectId);
      } else {
        // Fallback for environments where config is injected via env vars
        adminApp = admin.initializeApp();
        console.log('[Firebase Admin] Initialized with default credentials');
      }
    } catch (err) {
      console.warn('[Firebase Admin] Initialization warning:', err);
      try {
        adminApp = admin.app();
      } catch (e) {
        console.error('[Firebase Admin] Critical error: could not retrieve admin app instance.');
      }
    }
  }
  return adminApp;
}
