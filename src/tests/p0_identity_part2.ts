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
    name: 'global admin guard verifies Firebase identity before checking admin role',
    fn: async () => {
      const server = readSource('server.ts');
      const rateLimits = readSource('src/server/rate_limits.ts');
      const coarseLimit = server.indexOf('app.use(rateLimiterMiddleware(');
      const adminGuard = server.indexOf('app.use(adminPathBlocker())');
      const metricsStart = server.indexOf("app.get('/metrics'");
      const metricsRoute = server.slice(metricsStart, metricsStart + 180);
      return coarseLimit >= 0 && adminGuard > coarseLimit &&
        metricsStart >= 0 && metricsRoute.includes('rateLimiterByCategory()') &&
        rateLimits.includes('return authMiddleware(req, res, authorizeAdmin)');
    },
  },
  {
    name: 'identity-aware rate limits run only after user authentication',
    fn: async () => {
      const server = readSource('server.ts');
      const researchAuth = server.indexOf("app.use('/api/v1/research', authMiddleware)");
      const userAuth = server.indexOf("app.use('/api/v1/user', authMiddleware)");
      const categoryLimiter = server.indexOf('app.use(rateLimiterByCategory())');
      return researchAuth >= 0 && userAuth > researchAuth && categoryLimiter > userAuth;
    },
  },
  {
    name: 'job and report repository reads reject missing owner metadata',
    fn: async () => {
      const db = readSource('src/server/db.ts');
      const getJobStart = db.indexOf('public static async getJob');
      const getJobEnd = db.indexOf('public static async listJobs', getJobStart);
      const getJob = db.slice(getJobStart, getJobEnd);
      const getReportStart = db.indexOf('public static async getReport');
      const getReportEnd = db.indexOf('public static async deleteJob', getReportStart);
      const getReport = db.slice(getReportStart, getReportEnd);
      return getJob.includes('data.user_id !== userId') &&
        getJob.includes('data.deletion_requested_at') &&
        getReport.includes('jobData?.user_id !== userId') &&
        getReport.includes('jobData.deletion_requested_at') &&
        db.includes('!existing?.user_id || existing.user_id !== userId');
    },
  },
  {
    name: 'deletion tombstones prevent stale workers recreating jobs, reports, or orphaned events',
    fn: async () => {
      const db = readSource('src/server/db.ts');
      const pipeline = readSource('src/server/pipeline.ts');
      const guardedSaveStart = db.indexOf('public static async saveJobIfNonTerminal');
      const guardedSaveEnd = db.indexOf('public static async getJob', guardedSaveStart);
      const guardedSave = db.slice(guardedSaveStart, guardedSaveEnd);
      const addEventStart = db.indexOf('public static async addEvent');
      const addEventEnd = db.indexOf('public static async getEvents', addEventStart);
      const addEvent = db.slice(addEventStart, addEventEnd);
      const saveReportStart = db.indexOf('public static async saveReport');
      const saveReportEnd = db.indexOf('public static async getReport', saveReportStart);
      const saveReport = db.slice(saveReportStart, saveReportEnd);
      const deleteStart = db.indexOf('public static async deleteJob');
      const deleteJob = db.slice(deleteStart);
      return guardedSave.includes('if (!snapshot.exists) return false;') &&
        guardedSave.includes('existing.deletion_requested_at') &&
        addEvent.includes('transaction.get(jobRef)') &&
        addEvent.includes('jobData.deletion_requested_at') &&
        saveReport.includes('transaction.get(jobRef)') &&
        saveReport.includes('jobData.deletion_requested_at') &&
        deleteJob.includes('deletion_requested_at: FieldValue.serverTimestamp()') &&
        deleteJob.includes('const chunkSize = 450') &&
        pipeline.includes('DatabaseRepository.addEvent(job.id, event, userId)') &&
        pipeline.includes('if (!eventSaved) return false') &&
        pipeline.includes('A prior deletion attempt may have committed its tombstone') &&
        pipeline.includes('const resumed = await DatabaseRepository.deleteJob(jobId, userId, cleanupArtifacts)') &&
        pipeline.includes('await storage.deleteJob(jobId)') &&
        db.includes('if (cleanupArtifacts) await cleanupArtifacts()');
    },
  },
  {
    name: 'production defaults all persistence-critical stores to Firestore',
    fn: async () => {
      const middleware = readSource('src/server/middleware.ts');
      const cost = readSource('src/server/cost_governor.ts');
      const rate = readSource('src/server/rate_limits.ts');
      const cache = readSource('src/server/cache.ts');
      const render = readSource('render.yaml');
      const productionDefault = /productionDefaults = process\.env\.NODE_ENV === 'production' \|\| process\.env\.APP_ENV === 'production'/;
      return productionDefault.test(middleware) &&
        productionDefault.test(cost) &&
        productionDefault.test(rate) &&
        productionDefault.test(cache) &&
        render.includes('key: IDEMPOTENCY_STORE\n        value: firestore') &&
        render.includes('key: COST_STORE\n        value: firestore') &&
        render.includes('key: RATE_LIMIT_STORE\n        value: firestore') &&
        render.includes('key: CACHE_STORE\n        value: firestore');
    },
  },
  {
    name: 'idempotency reserves before handler and fails closed when Firestore is unavailable',
    fn: async () => {
      const middleware = readSource('src/server/middleware.ts');
      const claimStart = middleware.indexOf('void adminDb.runTransaction(async transaction => {', middleware.indexOf('export function idempotencyMiddleware'));
      const claimEnd = middleware.indexOf("}).then((decision: IdempotencyDecision)", claimStart);
      if (claimStart < 0 || claimEnd < 0) return false;
      const claim = middleware.slice(claimStart, claimEnd);
      const completionStart = middleware.indexOf('void adminDb.runTransaction(async transaction => {', middleware.indexOf('function installIdempotencyResponse'));
      const completionEnd = middleware.indexOf("}).then(committed => {", completionStart);
      if (completionStart < 0 || completionEnd < 0) return false;
      const completion = middleware.slice(completionStart, completionEnd);
      return !/res\.json|res\.status/.test(claim) &&
        claim.includes("state: 'IN_FLIGHT'") &&
        claim.includes('lock_token: lockToken') &&
        completion.includes("state: 'COMPLETED'") &&
        completion.includes('data.lock_token !== options.lockToken') &&
        completion.includes('transaction.update(ref') &&
        middleware.includes('IDEMPOTENCY_STORE_UNAVAILABLE') &&
        middleware.includes('sendIdempotencyError(\n      res, 503');
    },
  },
  {
    name: 'expired idempotency reservations are fenced and legacy records receive bounded expiry',
    fn: async () => {
      const middleware = readSource('src/server/middleware.ts');
      return middleware.includes('data.lock_token !== options.lockToken') &&
        middleware.includes('current.lock_token !== options.lockToken') &&
        middleware.includes('respondedAt ?? createdAt') &&
        middleware.includes('(createdAt ?? 0) + IDEMPOTENCY_PENDING_TTL_MS') &&
        middleware.includes("userId + '|' + path + '|' + idempotencyKey") &&
        middleware.includes('idempotencyRequestHash(method, path, req.body ?? null)');
    },
  },
  {
    name: 'queue readiness uses aggregate counts and fails closed when Firestore is unavailable',
    fn: async () => {
      const queue = readSource('src/server/firestore_queue.ts');
      const server = readSource('server.ts');
      const statsStart = queue.indexOf('async getStats()');
      const statsEnd = queue.indexOf('async getJobPosition', statsStart);
      const stats = queue.slice(statsStart, statsEnd);
      const readyStart = server.indexOf("app.get('/ready'");
      const readyEnd = server.indexOf('// OPERATIONAL METRICS', readyStart);
      const ready = server.slice(readyStart, readyEnd);
      return stats.includes('collection.count().get()') &&
        stats.includes("collection.where('status', '==', 'QUEUED').count().get()") &&
        !stats.includes('collection.get()') &&
        ready.includes('researchQueue.getStats()') &&
        ready.includes('res.status(503)');
    },
  },
  {
    name: 'stale queue recovery is expiry-indexed and scans beyond healthy running jobs',
    fn: async () => {
      const queue = readSource('src/server/firestore_queue.ts');
      const indexConfig = JSON.parse(readSource('firestore.indexes.json'));
      const start = queue.indexOf('async recoverStaleJobs()');
      const end = queue.indexOf('private async _recoverStaleJobTransaction', start);
      const recovery = queue.slice(start, end);
      const hasIndex = indexConfig.indexes.some((index: any) =>
        index.collectionGroup === 'job_queue' &&
        index.fields?.some((field: any) => field.fieldPath === 'status' && field.order === 'ASCENDING') &&
        index.fields?.some((field: any) => field.fieldPath === 'leased_until' && field.order === 'ASCENDING')
      );
      const hasFifoIndex = indexConfig.indexes.some((index: any) =>
        index.collectionGroup === 'job_queue' &&
        index.fields?.some((field: any) => field.fieldPath === 'status' && field.order === 'ASCENDING') &&
        index.fields?.some((field: any) => field.fieldPath === 'created_at' && field.order === 'ASCENDING')
      );
      const claimStart = queue.indexOf('async claimNextJob(');
      const claimEnd = queue.indexOf('async observeQueueDepth()', claimStart);
      const claim = queue.slice(claimStart, claimEnd);
      return claim.includes(".where('status', '==', 'QUEUED')") &&
        claim.includes(".orderBy('created_at', 'asc')") &&
        claim.includes('.limit(25)') &&
        hasFifoIndex &&
        recovery.includes(".where('status', '==', 'RUNNING')") &&
        recovery.includes(".where('leased_until', '<=', Timestamp.fromMillis(now))") &&
        recovery.includes(".orderBy('leased_until', 'asc')") &&
        recovery.includes('.limit(100)') &&
        hasIndex;
    },
  },
  {
    name: 'worker heartbeat and terminal writes require the exact per-claim lease token',
    fn: async () => {
      const queue = readSource('src/server/firestore_queue.ts');
      const pipeline = readSource('src/server/pipeline.ts');
      const heartbeatStart = queue.indexOf('async heartbeat(');
      const heartbeatEnd = queue.indexOf('async recoverStaleJobs', heartbeatStart);
      const heartbeat = queue.slice(heartbeatStart, heartbeatEnd);
      const statusStart = queue.indexOf('async updateJobStatus(');
      const statusEnd = queue.indexOf('async getStats()', statusStart);
      const status = queue.slice(statusStart, statusEnd);
      return heartbeat.includes('leaseId: string') &&
        heartbeat.includes('data?.lease_id === leaseId') &&
        status.includes('data?.lease_id !== leaseId') &&
        pipeline.includes("researchQueue.heartbeat(job!.id, workerId, String(job!.lease_id || ''))") &&
        pipeline.includes("researchQueue.updateJobStatus(job.id, 'COMPLETED', workerId, String(job.lease_id || ''))") &&
        pipeline.includes("researchQueue.updateJobStatus(job.id, 'FAILED', workerId, String(job.lease_id || ''))") &&
        pipeline.includes('if (!completed)') &&
        pipeline.includes('if (!failed)') &&
        pipeline.includes('queue.failure_finalize_suppressed');
    },
  },
  {
    name: 'report cache refuses stale entries after parent job deletion or tombstoning',
    fn: async () => {
      const cache = readSource('src/server/cache.ts');
      const pipeline = readSource('src/server/pipeline.ts');
      const cacheStart = cache.indexOf('static async getReportCached');
      const cacheEnd = cache.indexOf('static async invalidateReportCache', cacheStart);
      const readPath = cache.slice(cacheStart, cacheEnd);
      return readPath.includes('DatabaseRepository.getJob(jobId, userId)') &&
        readPath.includes('if (!liveJob)') &&
        readPath.includes('await store.del(key)') &&
        pipeline.includes('await CacheLayer.invalidateReportCache(jobId, userId)');
    },
  },
  {
    name: 'environment labels fail closed and staging cannot mount Vite dev middleware',
    fn: async () => {
      const environment = readSource('src/server/environment.ts');
      return environment.includes('Unknown \${source} value') &&
        environment.includes('conflicts with NODE_ENV') &&
        environment.includes("allowViteDevServer: name === 'development' || name === 'test'") &&
        environment.includes("cfg.name === 'staging'") &&
        environment.includes('APPLET_DEV_PROJECT_ID');
    },
  },
  {
    name: 'research job creation applies idempotency after authentication',
    fn: async () => {
      const server = readSource('server.ts');
      const routeStart = server.indexOf("app.post('/api/v1/research'");
      const route = server.slice(routeStart, routeStart + 160);
      const auth = server.indexOf("app.use('/api/v1/research', authMiddleware)");
      return routeStart >= 0 && route.includes('idempotencyMiddleware') && auth >= 0 && auth < routeStart;
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
      return requestCount === 5 &&
        timeoutCount === 5 &&
        planner.includes('timeoutMs = 90_000') &&
        planner.includes('maxOutputTokens: 1024') &&
        planner.includes('thinkingLevel: ThinkingLevel.LOW') &&
        planner.includes('responseSchema:') &&
        planner.includes("'gemini-3.5-flash-lite'") &&
        planner.includes("'gemini-3.6-flash'") &&
        planner.includes("logger.info('gemini.planning_started'") &&
        planner.includes("logger.warn('gemini.planning_fallback_started'") &&
        !planner.includes('temperature:') &&
        gemini.includes('deadline[_ ]?expired|deadline expired|504|gateway_timeout');
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
