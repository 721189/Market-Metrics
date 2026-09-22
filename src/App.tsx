/**
 * Market Research Agent V2 — Universal Intelligence Application
 * Adhering strictly to the V2 Architecture Blueprint.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.js';
import { Cpu } from 'lucide-react';
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

import { auth, loginWithGoogle, logout } from './lib/firebase.js';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentJob, setCurrentJob] = useState<ResearchJob | null>(null);
  const [report, setReport] = useState<FullResearchReport | null>(null);
  const [recentJobs, setRecentJobs] = useState<ResearchJob[]>([]);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [activeView, setActiveView] = useState<'workspace' | 'report' | 'evidence' | 'sources' | 'progress' | 'print'>('workspace');
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  
  const [inspectedClaim, setInspectedClaim] = useState<Claim | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Initial Load: Fetch existing research jobs list
  useEffect(() => {
    if (user) {
      fetchJobsList();
    } else {
      setRecentJobs([]);
      setCurrentJob(null);
      setReport(null);
    }

    return () => {
      eventSourceRef.current?.close();
    };
  }, [user]);

  const getHeaders = async () => {
    const token = await user?.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const fetchJobsList = async () => {
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/v1/research', { headers });
      const data = await res.json();
      if (data.jobs) {
        setRecentJobs(data.jobs);
      }
    } catch (err) {
      console.warn('Could not fetch jobs list:', err);
    }
  };

  const loadBenchmark = async (benchmarkId: string) => {
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/v1/benchmarks/${benchmarkId}`, { headers });
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
            sources_fetched: benchmarkReport.sources.filter(s => s.fetch_status === 'FETCHED').length,
            sources_fetch_failed: benchmarkReport.sources.filter(s => s.fetch_status === 'FETCH_FAILED').length,
            sources_analyzed: benchmarkReport.sources.filter(s => s.fetch_status === 'FETCHED').length,
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

  const subscribeToEvents = async (jobId: string, resumeAfter = 0) => {
    eventSourceRef.current?.close();

    // SSE cannot carry an Authorization header, and the Firebase ID token must
    // never travel in a URL. Mint a 60s single-use ticket over an authenticated
    // request, then hand only that ticket to EventSource.
    let ticket: string | undefined;
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/v1/research/${jobId}/stream-ticket`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        ticket = data.ticket;
      } else {
        console.error('Could not obtain stream ticket:', res.status);
        return;
      }
    } catch (err) {
      console.error('Stream ticket request failed:', err);
      return;
    }

    // `after` resumes a re-established stream: tickets are single-use and a new
    // EventSource cannot replay Last-Event-ID, so the client carries the last
    // sequence number it has seen.
    const es = new EventSource(
      `/api/v1/research/${jobId}/events?ticket=${ticket}&after=${resumeAfter}`
    );
    eventSourceRef.current = es;
    let lastSequence = resumeAfter;
    let terminal = false;

    es.onmessage = async (e) => {
      try {
        const evt: ResearchEvent = JSON.parse(e.data);
        if (typeof evt.sequence === 'number' && evt.sequence > lastSequence) {
          lastSequence = evt.sequence;
        }
        if (evt.event_type === 'completed' || evt.event_type === 'error') {
          terminal = true;
        }
        setEvents(prev => {
          if (prev.some(x => x.id === evt.id)) return prev;
          return [...prev, evt];
        });

        // Refresh job state
        const headers = await getHeaders();
        fetch(`/api/v1/research/${jobId}`, { headers })
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
      // The browser's native retry reuses the same URL — and the ticket in it
      // has already been consumed, so it would 401 forever. Close and
      // re-subscribe with a fresh ticket instead, resuming from the last
      // sequence we actually processed. A terminal event means the server
      // closed the stream deliberately: do not reconnect.
      if (terminal) return;
      es.close();
      if (eventSourceRef.current !== es) return; // superseded by a newer call
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          subscribeToEvents(jobId, lastSequence);
        }
      }, 1500);
    };
  };

  const handleLaunchResearch = async (requestData: ResearchJobRequest) => {
    try {
      setEvents([]);
      setReport(null);
      setActiveView('progress');

      const headers = await getHeaders();
      const res = await fetch('/api/v1/research', {
        method: 'POST',
        headers,
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
          sources_fetched: 0,
          sources_fetch_failed: 0,
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
      const headers = await getHeaders();
      await fetch(`/api/v1/research/${currentJob.id}/cancel`, { method: 'POST', headers });
      setCurrentJob(prev => prev ? { ...prev, status: 'CANCELLED' } : null);
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

  const handleExportJson = async () => {
    if (!currentJob) return;
    // Bearer header + programmatic download. The Firebase ID token is never
    // placed in a URL (previous behaviour used ?token=<idToken>).
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/v1/research/${currentJob.id}/export/json`, { headers });
      if (!res.ok) {
        console.error('JSON export failed:', res.status);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `research-${currentJob.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('JSON export failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 font-medium animate-pulse">Initializing Intelligence Core...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center gap-6">
            <div className="h-16 w-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Cpu className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Market Intelligence V2</h1>
              <p className="text-slate-400 mt-2">Institutional-grade research for strategic decision makers.</p>
            </div>
            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white text-slate-950 font-bold py-3.5 px-6 rounded-xl hover:bg-slate-100 transition-all active:scale-[0.98]"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="h-5 w-5" />
              Sign in with Google
            </button>
            <p className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold">Protected by Firebase Auth</p>
          </div>
        </div>
      </div>
    );
  }

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
        user={user}
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

      {/* System Health, Diagnostics & Test Suite Modal */}
      
    </div>
  );
}
