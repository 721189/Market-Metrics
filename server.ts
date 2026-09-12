/**
 * Full-Stack Production Express Server for Market Research Agent V2
 * Connected to Production Database Repository, Postgres Adapter, BullMQ Queue Worker,
 * Telemetry Engine, Financial/Security/E2E Test Suites, and Real Export Modules.
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { ResearchPipelineManager, pipelineEmitter } from './src/server/pipeline.js';
import { DatabaseRepository } from './src/server/db.js';
import { PostgresDatabaseAdapter } from './src/server/database_adapter.js';
import { BENCHMARKS, BENCHMARK_EV_CHARGING } from './src/server/benchmarks.js';
import {
  authMiddleware,
  rateLimiterMiddleware,
  idempotencyMiddleware,
  TelemetryEngine,
  requireRole,
} from './src/server/middleware.js';
import { TestSuiteRunner } from './src/server/test_suite.js';
import { researchQueue } from './src/server/queue_engine.js';
import { CostGuardManager } from './src/server/cost_guard.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware with size safety limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Global Telemetry & Request Timing
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    TelemetryEngine.activeConnections++;

    res.on('finish', () => {
      TelemetryEngine.activeConnections--;
      const duration = Date.now() - start;
      TelemetryEngine.recordRequest(req.method, req.path, res.statusCode, duration);

      if (res.statusCode >= 400 && req.path.startsWith('/api')) {
        TelemetryEngine.recordError(new Error(`HTTP ${res.statusCode} on ${req.method} ${req.path}`), req, res.statusCode);
      }
    });

    next();
  });

  // Global Security & Optimization Middleware
  app.use(idempotencyMiddleware);
  app.use(rateLimiterMiddleware({ maxRequests: 120, windowSec: 60 }));
  app.use(authMiddleware);

  // -------------------------------------------------------------
  // HEALTH & READINESS ENDPOINTS
  // -------------------------------------------------------------
  app.get('/health', async (req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime_seconds: process.uptime(),
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (req: Request, res: Response) => {
    const jobs = await ResearchPipelineManager.listJobs();
    const dbStatus = PostgresDatabaseAdapter.getInstance().getStatus();
    const queueStats = researchQueue.getStats();

    res.status(200).json({
      status: 'ready',
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
      environment: process.env.NODE_ENV || 'development',
      persisted_jobs_count: jobs.length,
      database: dbStatus,
      queue: queueStats,
      version: '2.0.0',
    });
  });

  // -------------------------------------------------------------
  // AUTHENTICATION HELPER
  // -------------------------------------------------------------
  app.post('/api/v1/auth/token', (req: Request, res: Response) => {
    const { role = 'analyst' } = req.body;
    const token = `mra_${role}_${Buffer.from(`user-${Date.now()}`).toString('base64')}`;
    res.json({
      access_token: token,
      token_type: 'Bearer',
      role,
      expires_in: 86400,
    });
  });

  // -------------------------------------------------------------
  // INSTITUTIONAL TEST SUITES API
  // -------------------------------------------------------------
  app.get('/api/v1/tests/financial', async (req: Request, res: Response) => {
    const result = await TestSuiteRunner.runFinancialSuite();
    res.json(result);
  });

  app.get('/api/v1/tests/security', async (req: Request, res: Response) => {
    const result = await TestSuiteRunner.runSecuritySuite();
    res.json(result);
  });

  app.get('/api/v1/tests/e2e', async (req: Request, res: Response) => {
    const result = await TestSuiteRunner.runE2ESuite();
    res.json(result);
  });

  app.get('/api/v1/tests/load', async (req: Request, res: Response) => {
    const result = await TestSuiteRunner.runLoadSuite(10);
    res.json(result);
  });

  // -------------------------------------------------------------
  // TELEMETRY, METRICS & DIAGNOSTICS API
  // -------------------------------------------------------------
  app.get('/api/v1/metrics', (req: Request, res: Response) => {
    const telemetry = TelemetryEngine.getMetrics();
    const queue = researchQueue.getStats();
    const costs = CostGuardManager.getMetrics();
    res.json({
      telemetry,
      queue,
      costs,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/errors', (req: Request, res: Response) => {
    res.json({
      errors: TelemetryEngine.errorLogs,
      count: TelemetryEngine.errorLogs.length,
    });
  });

  app.get('/api/v1/system/secrets', (req: Request, res: Response) => {
    res.json(CostGuardManager.getMaskedSecrets());
  });

  app.get('/api/v1/system/queue', (req: Request, res: Response) => {
    res.json(researchQueue.getStats());
  });

  app.get('/api/v1/system/cost', (req: Request, res: Response) => {
    res.json(CostGuardManager.getMetrics());
  });

  // -------------------------------------------------------------
  // ADMIN BACKUP & RESTORE API
  // -------------------------------------------------------------
  app.get('/api/v1/admin/backup', requireRole(['admin', 'analyst']), (req: Request, res: Response) => {
    const backup = PostgresDatabaseAdapter.getInstance().createBackup();
    res.setHeader('Content-Disposition', `attachment; filename="mra-backup-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  });

  app.post('/api/v1/admin/restore', requireRole(['admin']), (req: Request, res: Response) => {
    try {
      const result = PostgresDatabaseAdapter.getInstance().restoreBackup(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: { code: 'RESTORE_FAILED', message: err.message } });
    }
  });

  // -------------------------------------------------------------
  // BENCHMARK DATASETS (Golden fixtures)
  // -------------------------------------------------------------
  app.get('/api/v1/benchmarks', (req: Request, res: Response) => {
    res.json({
      benchmarks: [
        {
          id: 'ev-charging-india-2027',
          title: BENCHMARK_EV_CHARGING.title,
          question: BENCHMARK_EV_CHARGING.question,
          geography: BENCHMARK_EV_CHARGING.geography,
          industry: BENCHMARK_EV_CHARGING.industry,
          time_horizon: BENCHMARK_EV_CHARGING.time_horizon,
          evidence_score: BENCHMARK_EV_CHARGING.evidence_score_breakdown.overall_score,
          verified_claims_count: BENCHMARK_EV_CHARGING.claims.length,
          sources_count: BENCHMARK_EV_CHARGING.sources.length,
        },
      ],
    });
  });

  app.get('/api/v1/benchmarks/:id', (req: Request, res: Response) => {
    const bm = BENCHMARKS[req.params.id];
    if (!bm) {
      return res.status(404).json({ error: { code: 'BENCHMARK_NOT_FOUND', message: 'Benchmark not found' } });
    }
    res.json(bm);
  });

  // -------------------------------------------------------------
  // RESEARCH JOBS API
  // -------------------------------------------------------------
  app.post('/api/v1/research', async (req: Request, res: Response) => {
    try {
      const { question, industry, geography, time_horizon, objectives, target_company, competitors, scope_depth } = req.body;

      if (!question || typeof question !== 'string' || question.trim().length < 3) {
        return res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'A valid research question (min 3 chars) is required' },
        });
      }

      // Sanitize inputs
      const sanitizedQuestion = question.trim().slice(0, 1000);
      const sanitizedIndustry = (industry || 'Software & Technology').toString().trim().slice(0, 200);
      const sanitizedGeography = (geography || 'Global').toString().trim().slice(0, 100);
      const sanitizedHorizon = (time_horizon || '2026-2030').toString().trim().slice(0, 50);

      const job = await ResearchPipelineManager.createAndRunJob({
        question: sanitizedQuestion,
        industry: sanitizedIndustry,
        geography: sanitizedGeography,
        time_horizon: sanitizedHorizon,
        objectives: Array.isArray(objectives) ? objectives.map(o => String(o).slice(0, 100)) : undefined,
        target_company: target_company ? String(target_company).slice(0, 200) : undefined,
        competitors: Array.isArray(competitors) ? competitors.map(c => String(c).slice(0, 100)) : undefined,
        scope_depth: scope_depth === 'exhaustive' ? 'exhaustive' : scope_depth === 'standard' ? 'standard' : 'deep',
      });

      res.status(201).json({
        job_id: job.id,
        status: job.status,
        current_stage: job.current_stage,
        created_at: job.created_at,
      });
    } catch (err: any) {
      console.error('Error creating research job:', err);
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to initialize research job' },
      });
    }
  });

  // List all jobs
  app.get('/api/v1/research', async (req: Request, res: Response) => {
    const jobs = await ResearchPipelineManager.listJobs();
    res.json({ jobs, total: jobs.length });
  });

  // Get job details & progress
  app.get('/api/v1/research/:id', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({
        error: { code: 'RESEARCH_NOT_FOUND', message: `Research job ${req.params.id} not found` },
      });
    }
    res.json(job);
  });

  // Cancel job
  app.post('/api/v1/research/:id/cancel', async (req: Request, res: Response) => {
    const cancelled = await ResearchPipelineManager.cancelJob(req.params.id);
    if (!cancelled) {
      return res.status(400).json({
        error: { code: 'CANNOT_CANCEL', message: 'Job is not running or does not exist' },
      });
    }
    res.json({ status: 'CANCELLED', job_id: req.params.id });
  });

  // Server-Sent Events (SSE) stream for live job progress with Heartbeat Keep-Alive & Last-Event-ID resume
  app.get('/api/v1/research/:id/events', async (req: Request, res: Response) => {
    const jobId = req.params.id;
    const job = await ResearchPipelineManager.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: { code: 'RESEARCH_NOT_FOUND', message: 'Job not found' },
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Check Last-Event-ID header for automatic resume
    const lastEventId = parseInt(req.headers['last-event-id'] as string || '0', 10);

    // Send all existing events first
    const existingEvents = await ResearchPipelineManager.getEvents(jobId, lastEventId);
    existingEvents.forEach(evt => {
      res.write(`id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`);
    });

    // Heartbeat to keep connection alive through any intermediate proxies
    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    // Listen for new events
    const eventHandler = (evt: any) => {
      res.write(`id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`);
      if (evt.event_type === 'completed' || evt.event_type === 'error') {
        setTimeout(() => {
          clearInterval(heartbeatInterval);
          pipelineEmitter.off(`event:${jobId}`, eventHandler);
          res.end();
        }, 1500);
      }
    };

    pipelineEmitter.on(`event:${jobId}`, eventHandler);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      pipelineEmitter.off(`event:${jobId}`, eventHandler);
    });
  });

  // Get Sources
  app.get('/api/v1/research/:id/sources', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report or job not found' } });
    }
    res.json({ sources: job.report.sources, count: job.report.sources.length });
  });

  // Get Evidence Pool
  app.get('/api/v1/research/:id/evidence', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report or job not found' } });
    }
    res.json({ evidence: job.report.evidence_pool, count: job.report.evidence_pool.length });
  });

  // Get Claims
  app.get('/api/v1/research/:id/claims', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report or job not found' } });
    }
    res.json({ claims: job.report.claims, count: job.report.claims.length });
  });

  // Get Structured Report
  app.get('/api/v1/research/:id/report', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (!job.report) {
      return res.status(202).json({
        status: job.status,
        current_stage: job.current_stage,
        progress: job.progress,
        message: 'Report is currently compiling',
      });
    }
    res.json(job.report);
  });

  // Export Structured JSON
  app.get('/api/v1/research/:id/export/json', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not ready' } });
    }
    res.setHeader('Content-Disposition', `attachment; filename="market-intelligence-${job.id}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(job.report, null, 2));
  });

  // Export Structured CSV (Claims + Evidence + Financials)
  app.get('/api/v1/research/:id/export/csv', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not ready' } });
    }

    const report = job.report;
    const lines: string[] = [];

    // Header metadata
    lines.push(`"MARKET RESEARCH REPORT","${report.title.replace(/"/g, '""')}"`);
    lines.push(`"Question","${report.question.replace(/"/g, '""')}"`);
    lines.push(`"Industry","${report.industry}"`);
    lines.push(`"Geography","${report.geography}"`);
    lines.push(`"Time Horizon","${report.time_horizon}"`);
    lines.push(`"Evidence Score","${report.evidence_score_breakdown.overall_score}/100"`);
    lines.push('');

    // Claims section
    lines.push('"CLAIMS AND PROVENANCE"');
    lines.push('"Citation #","Claim Type","Statement","Status","Confidence Score","Reasoning"');
    report.claims.forEach(c => {
      lines.push(`"[${c.citation_number}]","${c.claim_type}","${c.statement.replace(/"/g, '""')}","${c.verification_status}","${c.confidence}%","${c.reasoning.replace(/"/g, '""')}"`);
    });
    lines.push('');

    // Sources section
    lines.push('"SOURCES APPENDIX"');
    lines.push('"ID","Tier","Domain","Publisher","URL","Reliability Score"');
    report.sources.forEach(s => {
      lines.push(`"${s.id}","${s.source_type}","${s.domain}","${s.publisher.replace(/"/g, '""')}","${s.url}","${s.reliability_score}%"`);
    });

    res.setHeader('Content-Disposition', `attachment; filename="market-intelligence-${job.id}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(lines.join('\n'));
  });

  // Export High-Resolution Printable PDF Dossier
  app.get('/api/v1/research/:id/export/pdf', async (req: Request, res: Response) => {
    const job = await ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not ready' } });
    }

    const rep = job.report;
    const printHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${rep.title}</title>
  <style>
    @page { size: letter; margin: 18mm 16mm; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6; font-size: 11pt; }
    h1 { font-size: 20pt; color: #0f172a; margin-bottom: 4px; }
    h2 { font-size: 14pt; color: #1e293b; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4px; margin-top: 24px; page-break-after: avoid; }
    .header-bar { border-left: 4px solid #3b82f6; padding-left: 12px; margin-bottom: 20px; }
    .score-badge { display: inline-block; background: #ecfdf5; color: #047857; font-weight: bold; padding: 4px 10px; border-radius: 4px; border: 1px solid #a7f3d0; }
    .claim-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 6px; margin-bottom: 8px; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 9.5pt; }
    th { background: #f1f5f9; text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1; }
    td { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: top; }
    .footer { margin-top: 30px; font-size: 8pt; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header-bar">
    <h1>${rep.title}</h1>
    <div style="color: #64748b; font-size: 10pt;">
      Scope: ${rep.industry} | Geography: ${rep.geography} | Horizon: ${rep.time_horizon} | Evidence Score: <span class="score-badge">${rep.evidence_score_breakdown.overall_score}/100</span>
    </div>
  </div>

  <h2>1. Executive Strategic Summary</h2>
  <p>${rep.executive_summary}</p>

  <h2>2. Key Macro Intelligence Sections</h2>
  ${rep.sections.map(s => `<h3>${s.title}</h3><p>${s.content}</p>`).join('')}

  <h2>3. Verified Claims & Provenance Registry</h2>
  ${rep.claims.map(c => `
    <div class="claim-box">
      <strong>[${c.citation_number}] ${c.statement}</strong><br/>
      <small style="color: #64748b;">Type: ${c.claim_type} | Status: ${c.verification_status} | Confidence: ${c.confidence}%</small><br/>
      <small><em>Reasoning: ${c.reasoning}</em></small>
    </div>
  `).join('')}

  <h2>4. Authoritative Sources Appendix</h2>
  <table>
    <thead>
      <tr><th>ID</th><th>Tier</th><th>Publisher</th><th>Domain</th><th>Reliability</th></tr>
    </thead>
    <tbody>
      ${rep.sources.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${s.source_type}</td>
          <td>${s.publisher}</td>
          <td>${s.domain}</td>
          <td>${s.reliability_score}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    Generated by Market Research Agent V2 • Provenance-Verified Institutional Intelligence Report • ${new Date().toLocaleDateString()}
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(printHtml);
  });

  // -------------------------------------------------------------
  // VITE MIDDLEWARE (Development & Static Production)
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Market Intelligence Agent V2 running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
