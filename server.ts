/**
 * Full-Stack High-Performance Express Server for Market Research Agent V2
 * Connected to Production Database Repository & Multi-Stage State Machine Worker
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { ResearchPipelineManager, pipelineEmitter } from './src/server/pipeline.js';
import { DatabaseRepository } from './src/server/db.js';
import { BENCHMARKS, BENCHMARK_EV_CHARGING } from './src/server/benchmarks.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware with size safety limits
  app.use(express.json({ limit: '500kb' }));
  app.use(express.urlencoded({ extended: true, limit: '500kb' }));

  // Request logger & timing
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api') && duration > 500) {
        console.log(`[API Slow] ${req.method} ${req.path} took ${duration}ms`);
      }
    });
    next();
  });

  // -------------------------------------------------------------
  // HEALTH & READINESS ENDPOINTS
  // -------------------------------------------------------------
  app.get('/health', async (req: Request, res: Response) => {
    res.status(200).json({ 
      status: 'ok', 
      uptime_seconds: process.uptime(),
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp: new Date().toISOString() 
    });
  });

  app.get('/ready', async (req: Request, res: Response) => {
    const jobs = await ResearchPipelineManager.listJobs();
    res.status(200).json({
      status: 'ready',
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
      environment: process.env.NODE_ENV || 'development',
      persisted_jobs_count: jobs.length,
      version: '2.0.0',
    });
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
  // Create research job with strict validation
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

  // Server-Sent Events (SSE) stream for live job progress with Heartbeat Keep-Alive
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

    // Send all existing events first
    const existingEvents = await ResearchPipelineManager.getEvents(jobId);
    existingEvents.forEach(evt => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    });

    // Heartbeat to keep connection alive through any intermediate proxies
    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    // Listen for new events
    const eventHandler = (evt: any) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
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
        message: 'Report is currently compiling' 
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
