/**
 * Market Research Agent V2 — Universal Intelligence Application
 * Adhering strictly to the V2 Architecture Blueprint.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.js';
import { HomeWorkspace } from './components/HomeWorkspace.js';
import { NewResearchModal } from './components/NewResearchModal.js';
import { ResearchProgress } from './components/ResearchProgress.js';
import { ReportViewer } from './components/ReportViewer.js';
import { EvidenceExplorer } from './components/EvidenceExplorer.js';
import { SourcesAppendix } from './components/SourcesAppendix.js';
import { CitationModal } from './components/CitationModal.js';
import { PrintReportView } from './components/PrintReportView.js';
import type { 
  ResearchJob, 
  FullResearchReport, 
  ResearchEvent, 
  ResearchJobRequest,
  Claim 
} from './types.js';

export default function App() {
  const [currentJob, setCurrentJob] = useState<ResearchJob | null>(null);
  const [report, setReport] = useState<FullResearchReport | null>(null);
  const [recentJobs, setRecentJobs] = useState<ResearchJob[]>([]);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [activeView, setActiveView] = useState<'workspace' | 'report' | 'evidence' | 'sources' | 'progress' | 'print'>('workspace');
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [inspectedClaim, setInspectedClaim] = useState<Claim | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Initial Load: Fetch existing research jobs list (without forcing a mock report)
  useEffect(() => {
    fetchJobsList();

    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const fetchJobsList = () => {
    fetch('/api/v1/research')
      .then(res => res.json())
      .then(data => {
        if (data.jobs && data.jobs.length > 0) {
          setRecentJobs(data.jobs);
        }
      })
      .catch(err => {
        console.warn('Could not fetch jobs list:', err);
      });
  };

  const loadBenchmark = async (benchmarkId: string) => {
    try {
      const res = await fetch(`/api/v1/benchmarks/${benchmarkId}`);
      if (res.ok) {
        const benchmarkReport: FullResearchReport = await res.json();
        setReport(benchmarkReport);
        const benchmarkJob: ResearchJob = {
          id: benchmarkReport.job_id,
          question: benchmarkReport.question,
          industry: benchmarkReport.industry,
          geography: benchmarkReport.geography,
          time_horizon: benchmarkReport.time_horizon,
          objectives: ['Market Sizing', 'Competitors', 'Pricing', 'Financials', 'Strategic Roadmap'],
          status: 'COMPLETED',
          current_stage: 'GENERATING_REPORT',
          progress: 100,
          created_at: benchmarkReport.generated_at,
          completed_at: benchmarkReport.generated_at,
          stats: {
            sources_discovered: benchmarkReport.sources.length,
            sources_analyzed: benchmarkReport.sources.length,
            evidence_items: benchmarkReport.evidence_pool.length,
            claims_total: benchmarkReport.claims.length,
            claims_verified: benchmarkReport.claims.filter(c => c.verification_status === 'SUPPORTED').length,
            claims_contradicted: benchmarkReport.claims.filter(c => c.verification_status === 'CONTRADICTED').length,
            claims_insufficient: benchmarkReport.claims.filter(c => c.verification_status === 'INSUFFICIENT').length,
            evidence_score: benchmarkReport.evidence_score_breakdown.overall_score,
          },
          stages: [],
          report: benchmarkReport,
        };
        setCurrentJob(benchmarkJob);
        setActiveView('report');
      }
    } catch (e) {
      console.warn('Could not fetch benchmark:', e);
    }
  };

  const subscribeToEvents = (jobId: string) => {
    eventSourceRef.current?.close();

    const es = new EventSource(`/api/v1/research/${jobId}/events`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt: ResearchEvent = JSON.parse(e.data);
        setEvents(prev => {
          if (prev.some(x => x.id === evt.id)) return prev;
          return [...prev, evt];
        });

        // Refresh job state
        fetch(`/api/v1/research/${jobId}`)
          .then(r => r.json())
          .then((updatedJob: ResearchJob) => {
            setCurrentJob(updatedJob);
            if (updatedJob.report) {
              setReport(updatedJob.report);
            }
            fetchJobsList();
          });
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    es.onerror = () => {
      // Reconnect handled natively by browser
    };
  };

  const handleLaunchResearch = async (requestData: ResearchJobRequest) => {
    try {
      setEvents([]);
      setReport(null);
      setActiveView('progress');

      const res = await fetch('/api/v1/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!res.ok) {
        throw new Error('Failed to create research job');
      }

      const created = await res.json();
      const initialJob: ResearchJob = {
        id: created.job_id,
        question: requestData.question,
        industry: requestData.industry,
        geography: requestData.geography,
        time_horizon: requestData.time_horizon,
        objectives: requestData.objectives,
        target_company: requestData.target_company,
        competitors_input: requestData.competitors,
        status: created.status,
        current_stage: created.current_stage,
        progress: 0,
        created_at: created.created_at,
        stats: {
          sources_discovered: 0,
          sources_analyzed: 0,
          evidence_items: 0,
          claims_total: 0,
          claims_verified: 0,
          claims_contradicted: 0,
          claims_insufficient: 0,
          evidence_score: 0,
        },
        stages: [],
      };

      setCurrentJob(initialJob);
      subscribeToEvents(created.job_id);
    } catch (err: any) {
      console.error('Launch research failed:', err);
      alert(`Could not start research job: ${err.message}`);
    }
  };

  const handleOpenExistingJob = (job: ResearchJob) => {
    setCurrentJob(job);
    if (job.report) {
      setReport(job.report);
      setActiveView('report');
    } else {
      setActiveView('progress');
      subscribeToEvents(job.id);
    }
  };

  const handleCancelJob = async () => {
    if (!currentJob) return;
    try {
      await fetch(`/api/v1/research/${currentJob.id}/cancel`, { method: 'POST' });
      setCurrentJob(prev => prev ? { ...prev, status: 'CANCELLED' } : null);
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

  const handleExportJson = () => {
    if (!currentJob) return;
    window.open(`/api/v1/research/${currentJob.id}/export/json`, '_blank');
  };

  if (activeView === 'print' && report) {
    return (
      <PrintReportView
        report={report}
        onBack={() => setActiveView('report')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* Top Navbar Header */}
      <Header
        currentJob={currentJob}
        report={report}
        onNewResearch={() => setIsNewModalOpen(true)}
        onSelectBenchmark={loadBenchmark}
        activeView={activeView === 'print' ? 'report' : activeView}
        setActiveView={(v) => setActiveView(v)}
        onExportJson={handleExportJson}
        onPrintReport={() => setActiveView('print')}
      />

      {/* Main Body View */}
      <main className="flex-1 pb-16">
        {activeView === 'workspace' && (
          <HomeWorkspace
            onLaunchResearch={handleLaunchResearch}
            recentJobs={recentJobs}
            onOpenJob={handleOpenExistingJob}
          />
        )}

        {activeView === 'progress' && currentJob && (
          <ResearchProgress
            job={currentJob}
            events={events}
            onCancel={handleCancelJob}
            onViewReport={() => setActiveView('report')}
          />
        )}

        {activeView === 'report' && report && (
          <ReportViewer
            report={report}
            onInspectClaim={(claim) => setInspectedClaim(claim)}
            onNavigateTab={(tab) => setActiveView(tab)}
          />
        )}

        {activeView === 'evidence' && report && (
          <EvidenceExplorer
            report={report}
            onInspectClaim={(claim) => setInspectedClaim(claim)}
          />
        )}

        {activeView === 'sources' && report && (
          <SourcesAppendix report={report} />
        )}
      </main>

      {/* New Research Form Modal */}
      <NewResearchModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSubmit={handleLaunchResearch}
        onLoadBenchmark={loadBenchmark}
      />

      {/* Citation / Provenance Drilldown Modal */}
      <CitationModal
        claim={inspectedClaim}
        onClose={() => setInspectedClaim(null)}
      />
    </div>
  );
}
