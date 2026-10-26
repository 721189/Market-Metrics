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
      // The export flow now lives in a shared helper (src/lib/download.ts); read
      // it too so the guard covers where the token is actually consumed.
      const download = readSource('src/lib/download.ts');
      const sources = [app, download];
      // Precise check: a token must never be interpolated into a query string
      // (?token=${...}). Prose that mentions the old behaviour is not a defect.
      const tokenInterpolatedIntoUrl = sources.some((s) => /[?&]token=\$\{/.test(s));
      const usesTicket =
        /stream-ticket/.test(app) && /events\?ticket=\$\{ticket\}/.test(app);
      // Exports must go through the authenticated blob download (Bearer header +
      // createObjectURL), never a cookieless <a href download>.
      const exportUsesBlob =
        download.includes('Authorization') &&
        download.includes('createObjectURL') &&
        /authenticatedDownload\(/.test(app);
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
    name: 'all nine pipeline stages have explicit start and completion transitions',
    fn: async () => {
      const pipeline = readSource('src/server/pipeline.ts');
      const stageStarted = (stage: string) => new RegExp("logAndEmitEvent\\([\\s\\S]{0,250}'stage_started',\\s*'" + stage + "'").test(pipeline);
      const stageCompleted = (stage: string) => new RegExp("logAndEmitEvent\\([\\s\\S]{0,250}'stage_completed',\\s*'" + stage + "'").test(pipeline);
      const stages = [
        'PLANNING', 'DISCOVERING', 'FETCHING', 'EXTRACTING',
        'BUILDING_CLAIMS', 'VERIFYING', 'ANALYZING', 'SYNTHESIZING',
      ];
      return stages.every(stageStarted) && stages.every(stageCompleted) &&
        stageStarted('GENERATING_REPORT') &&
        pipeline.includes("'completed', 'GENERATING_REPORT'");
    },
  },
  {
    name: 'terminal jobs mark unfinished stages skipped and display errors in the UI',
    fn: async () => {
      const pipeline = readSource('src/server/pipeline.ts');
      const progress = readSource('src/components/ResearchProgress.tsx');
      return pipeline.includes("stageItem.status = 'FAILED'") &&
        pipeline.includes("stageItem.status = 'SKIPPED'") &&
        progress.includes('job.error_message') &&
        progress.includes('isFailedStage');
    },
  },
  {
    name: 'citation graph validates excerpt-local quotes against absolute source offsets and refs',
    fn: async () => {
      const pipeline = readSource('src/server/pipeline.ts');
      const graph = readSource('src/server/citation_graph.ts');
      const types = readSource('src/types.ts');
      return pipeline.includes('CitationGraphValidator.validate(finalReport, sourceTexts, sourceArtifactRefs)') &&
        graph.includes('EVIDENCE_PROVENANCE_MISMATCH') &&
        graph.includes('sourceText.slice(sourceStart, sourceEnd)') &&
        types.includes('source_document_start_offset') &&
        types.includes('source_document_ref');
    },
  },
  {
    name: 'production Gemini readiness ignores descriptive credential labels',
    fn: async () => {
      const environment = readSource('src/server/environment.ts');
      const gemini = readSource('src/server/gemini.ts');
      return /geminiCredentialSource:\s*env\.GEMINI_API_KEY\?\.trim\(\)/.test(environment) &&
        /GEMINI_API_KEY must be configured/.test(environment) &&
        !/geminiCredentialSource:\s*\(env\.GEMINI_CREDENTIAL_SOURCE/.test(environment) &&
        /process\.env\.GEMINI_API_KEY\?\.trim\(\)/.test(gemini);
    },
  },
  {
    name: 'document fetch shares deadline across DNS, redirects, body and extraction',
    fn: async () => {
      const fetcher = readSource('src/server/fetcher.ts');
      const pipeline = readSource('src/server/pipeline.ts');
      return /parentSignal\?: AbortSignal/.test(fetcher) &&
        /DocumentFetchTimeoutError/.test(fetcher) &&
        /awaitWithAbort\(this\.resolveIp/.test(fetcher) &&
        /deadlineAt/.test(fetcher) &&
        /lookup:\s*pinnedLookup/.test(fetcher) &&
        /awaitWithAbort\(readBody\(\), controller\.signal\)/.test(fetcher) &&
        /fetchUrl\(src\.url, 5000, signal\)/.test(pipeline) &&
        /if \(isCancelled\(job, signal\)\) return;[\s\S]{0,140}FETCH_FAILED/.test(pipeline);
    },
  },
  {
    name: 'Gemini model requests have bounded HTTP deadlines and planner output budget',
    fn: async () => {
      const gemini = readSource('src/server/gemini.ts');
      const requestCount = gemini.split('ai.models.generateContent({').length - 1;
      const timeoutCount = gemini.split('httpOptions: { timeout:').length - 1;
      const plannerStart = gemini.indexOf('planResearch(');
      const plannerEnd = gemini.indexOf('discoverLiveSources(', plannerStart);
      const planner = gemini.slice(plannerStart, plannerEnd);
      return requestCount === 6 &&
        timeoutCount === 6 &&
        planner.includes('maxOutputTokens: 2048') &&
        planner.includes("thinkingLevel: 'low'") &&
        planner.includes('responseSchema:') &&
        planner.includes("logger.info('gemini.planning_started'") &&
        planner.includes('duration_ms: Date.now() - startedAt');
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
