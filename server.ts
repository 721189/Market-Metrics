/**
 * Full-Stack Express Server for Market Research Agent V2
 * Meets all blueprint API requirements & Vite SPA middleware integration.
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { ResearchPipelineManager, pipelineEmitter } from './src/server/pipeline.js';
import { BENCHMARKS, BENCHMARK_EV_CHARGING } from './src/server/benchmarks.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // -------------------------------------------------------------
  // HEALTH & READINESS ENDPOINTS (Section 44)
  // -------------------------------------------------------------
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/ready', (req, res) => {
    res.json({
      status: 'ready',
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.0',
    });
  });

  // -------------------------------------------------------------
  // BENCHMARK DATASETS (Golden fixtures for immediate review)
  // -------------------------------------------------------------
  app.get('/api/v1/benchmarks', (req, res) => {
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

  app.get('/api/v1/benchmarks/:id', (req, res) => {
    const bm = BENCHMARKS[req.params.id];
    if (!bm) {
      return res.status(404).json({ error: { code: 'BENCHMARK_NOT_FOUND', message: 'Benchmark not found' } });
    }
    res.json(bm);
  });

  // -------------------------------------------------------------
  // RESEARCH JOBS API (Section 38 - 43)
  // -------------------------------------------------------------
  // Create research job
  app.post('/api/v1/research', async (req, res) => {
    try {
      const { question, industry, geography, time_horizon, objectives, target_company, competitors, scope_depth } = req.body;

      if (!question) {
        return res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'Research question is required' },
        });
      }

      const job = await ResearchPipelineManager.createAndRunJob({
        question,
        industry: industry || 'Technology & Software',
        geography: geography || 'Global',
        time_horizon: time_horizon || '2026-2030',
        objectives: objectives || ['Market Sizing', 'Competitors', 'Pricing', 'Regulatory', 'Recommendations'],
        target_company,
        competitors,
        scope_depth: scope_depth || 'standard',
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
  app.get('/api/v1/research', (req, res) => {
    const jobs = ResearchPipelineManager.listJobs();
    res.json({ jobs });
  });

  // Get job details & progress
  app.get('/api/v1/research/:id', (req, res) => {
    const job = ResearchPipelineManager.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({
        error: { code: 'RESEARCH_NOT_FOUND', message: `Research job ${req.params.id} not found` },
      });
    }
    res.json(job);
  });

  // Cancel job
  app.post('/api/v1/research/:id/cancel', (req, res) => {
    const cancelled = ResearchPipelineManager.cancelJob(req.params.id);
    if (!cancelled) {
      return res.status(400).json({
        error: { code: 'CANNOT_CANCEL', message: 'Job is not running or does not exist' },
      });
    }
    res.json({ status: 'CANCELLED', job_id: req.params.id });
  });

  // Server-Sent Events (SSE) stream for live job progress
  app.get('/api/v1/research/:id/events', (req, res) => {
    const jobId = req.params.id;
    const job = ResearchPipelineManager.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: { code: 'RESEARCH_NOT_FOUND', message: 'Job not found' },
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Send all existing events first
    const existingEvents = ResearchPipelineManager.getEvents(jobId);
    existingEvents.forEach(evt => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    });

    // Listen for new events
    const eventHandler = (evt: any) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      if (evt.event_type === 'completed' || evt.event_type === 'error') {
        // Close after finish
        setTimeout(() => {
          pipelineEmitter.off(`event:${jobId}`, eventHandler);
          res.end();
        }, 1000);
      }
    };

    pipelineEmitter.on(`event:${jobId}`, eventHandler);

    req.on('close', () => {
      pipelineEmitter.off(`event:${jobId}`, eventHandler);
    });
  });

  // Get Sources
  app.get('/api/v1/research/:id/sources', (req, res) => {
    const job = ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report or job not found' } });
    }
    res.json({ sources: job.report.sources });
  });

  // Get Evidence Pool
  app.get('/api/v1/research/:id/evidence', (req, res) => {
    const job = ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report or job not found' } });
    }
    res.json({ evidence: job.report.evidence_pool });
  });

  // Get Claims
  app.get('/api/v1/research/:id/claims', (req, res) => {
    const job = ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report or job not found' } });
    }
    res.json({ claims: job.report.claims });
  });

  // Get Structured Report
  app.get('/api/v1/research/:id/report', (req, res) => {
    const job = ResearchPipelineManager.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (!job.report) {
      return res.status(202).json({ status: job.status, current_stage: job.current_stage, progress: job.progress, message: 'Report is still being generated' });
    }
    res.json(job.report);
  });

  // Export JSON
  app.get('/api/v1/research/:id/export/json', (req, res) => {
    const job = ResearchPipelineManager.getJob(req.params.id);
    if (!job || !job.report) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not ready' } });
    }
    res.setHeader('Content-Disposition', `attachment; filename="market-research-${job.id}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(job.report, null, 2));
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Market Research Agent V2 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
