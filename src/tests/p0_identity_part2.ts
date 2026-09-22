/**
 * P0 Identity & SSE Ticket Suite — part 2
 * Static source guards: these assert the shape of the deployed code so that the
 * identity escape hatch, URL-borne tokens, and default-tenant fallbacks cannot
 * silently return in a future change.
 */

import fs from 'fs';
import path from 'path';
import { ResearchPipelineManager } from '../server/pipeline.js';
import type { Check } from './deploy_layer.test.js';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

export const p0IdentityStaticChecks: Check[] = [
  {
    name: 'server identity has no X-User-Id fallback and no default tenant',
    fn: async () => {
      const server = readSource('server.ts');
      // Assert the header is never READ (a comment mentioning it is fine), and
      // that getUserId does not OR in a non-authenticated identity.
      const readsHeader = /headers\[\s*['"]x-user-id['"]\s*\]/i.test(server);
      const hasDefaultTenant = /default_tenant/.test(server);
      const getUserIdFallsBack = /user\?\.uid\s*\|\|/.test(server);
      return !readsHeader && !hasDefaultTenant && !getUserIdFallsBack;
    },
  },
  {
    name: 'CORS no longer advertises X-User-Id as an accepted header',
    fn: async () => !/x-user-id/i.test(readSource('src/server/cors.ts')),
  },
  {
    name: 'no default tenant survives anywhere in pipeline or server sources',
    fn: async () => {
      const files = [
        'src/server/pipeline.ts',
        'src/server/db.ts',
        'src/server/firestore_queue.ts',
        'server.ts',
      ];
      return files.every((f) => !/default_tenant|'default_user'/.test(readSource(f)));
    },
  },
  {
    name: 'client never places a Firebase ID token in a URL',
    fn: async () => {
      const app = readSource('src/App.tsx');
      // Precise check: a token must never be interpolated into a query string
      // (?token=${...}). Prose that mentions the old behaviour is not a defect.
      const tokenInterpolatedIntoUrl = /[?&]token=\$\{/.test(app);
      const usesTicket =
        /stream-ticket/.test(app) && /events\?ticket=\$\{ticket\}/.test(app);
      const exportUsesBlob =
        /fetch\(`\/api\/v1\/research\/\$\{currentJob\.id\}\/export\/json`,\s*\{\s*headers\s*\}\)/.test(app) &&
        /createObjectURL/.test(app);
      return !tokenInterpolatedIntoUrl && usesTicket && exportUsesBlob;
    },
  },
  {
    name: 'SSE route consumes a ticket and never verifies a query token',
    fn: async () => {
      const server = readSource('server.ts');
      const routeStart = server.indexOf("'/api/v1/research/:id/events'");
      if (routeStart === -1) return false;
      const routeBody = server.slice(routeStart, routeStart + 2000);
      return (
        /getStreamTicketStore\(\)\.consume\(/.test(routeBody) &&
        !/req\.query\.token/.test(routeBody) &&
        !/verifyIdToken/.test(routeBody)
      );
    },
  },
  {
    name: 'pipeline rejects an empty userId instead of defaulting',
    fn: async () => {
      let listThrew = false;
      let getThrew = false;
      try {
        await ResearchPipelineManager.listJobs('');
      } catch {
        listThrew = true;
      }
      try {
        await ResearchPipelineManager.getJob('job-any', '');
      } catch {
        getThrew = true;
      }
      return listThrew && getThrew;
    },
  },
  {
    name: 'data layer binds the environment project, not the applet config file',
    fn: async () => {
      const admin = readSource('src/lib/firebase-admin.ts');
      // Assert the applet JSON is not IMPORTED (comments may reference it), and
      // that the project/database come from the environment resolver.
      const importsAppletJson = /from\s+['"][^'"]*firebase-applet-config\.json['"]/.test(admin);
      const usesEnvironment = /loadEnvironmentConfig/.test(admin);
      return !importsAppletJson && usesEnvironment;
    },
  },
  {
    name: 'production frontend build requires VITE_FIREBASE_* configuration',
    fn: async () => {
      const client = readSource('src/lib/firebase.ts');
      return (
        /import\.meta\.env\.DEV/.test(client) &&
        /VITE_FIREBASE_PROJECT_ID/.test(client) &&
        /missing required env/.test(client)
      );
    },
  },
];
