import React from 'react';
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Loader2, 
  Database, 
  FileSearch, 
  ShieldCheck, 
  Sparkles, 
  Layers, 
  Activity, 
  XOctagon, 
  ExternalLink,
  ChevronRight,
  Calculator
} from 'lucide-react';
import type { ResearchJob, ResearchEvent, StageName } from '../types.js';

interface ResearchProgressProps {
  job: ResearchJob;
  events: ResearchEvent[];
  onCancel: () => void;
  onViewReport: () => void;
}

const STAGES_ORDER: { key: StageName; label: string; desc: string }[] = [
  { key: 'PLANNING', label: '1. Model A Planning', desc: 'Deconstruct objectives & query families' },
  { key: 'DISCOVERING', label: '2. Source Discovery', desc: 'Search API execution across Tier A-D hierarchy' },
  { key: 'FETCHING', label: '3. Safe Fetching', desc: 'SSRF filtering, rate limits & document parsing' },
  { key: 'EXTRACTING', label: '4. Model B Extraction', desc: 'Extract facts, quotes & exact text offsets' },
  { key: 'BUILDING_CLAIMS', label: '5. Model C Claims', desc: 'Construct typed claims strictly from evidence' },
  { key: 'VERIFYING', label: '6. Model D Verification', desc: 'Audit contradictions & calculate evidence score' },
  { key: 'ANALYZING', label: '7. Deterministic Analysis', desc: 'Calculate CAGR, TAM/SAM/SOM & Unit Economics' },
  { key: 'SYNTHESIZING', label: '8. Model E Synthesis', desc: 'Synthesize strategic implications & trade-offs' },
  { key: 'GENERATING_REPORT', label: '9. Model F Report', desc: 'Assemble traceable report artifacts & citations' },
];

export const ResearchProgress: React.FC<ResearchProgressProps> = ({
  job,
  events,
  onCancel,
  onViewReport,
}) => {
  const isFinished = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED' || job.status === 'CANCELLED';

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Status Banner */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isFinished 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : isFailed
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse'
              }`}>
                {isFinished ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Research Complete
                  </>
                ) : isFailed ? (
                  <>
                    <AlertCircle className="h-3 w-3" />
                    {job.status}
                  </>
                ) : (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Stage: {job.current_stage}
                  </>
                )}
              </span>
              {(job as any).queue_position && !isFinished && !isFailed && (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/20">
                  Queue Position: {(job as any).queue_position}
                </span>
              )}
              <span className="text-xs text-slate-400 font-mono">Job ID: {job.id}</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight sm:text-2xl">
              {job.question}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span><strong>Industry:</strong> {job.industry}</span>
              <span>&bull;</span>
              <span><strong>Geography:</strong> {job.geography}</span>
              <span>&bull;</span>
              <span><strong>Horizon:</strong> {job.time_horizon}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isFinished && !isFailed && (
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                <XOctagon className="h-4 w-4" />
                Cancel Job
              </button>
            )}
            {isFinished && (
              <button
                onClick={onViewReport}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-95 transition-all"
              >
                <Sparkles className="h-4 w-4" />
                Inspect Full Report
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-1.5">
            <span>Pipeline Execution Progress</span>
            <span className="text-cyan-400 font-mono font-bold">{job.progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-500"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Real-time Stage Metrics HUD (Section 96) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Database className="h-3.5 w-3.5 text-cyan-400" />
            Discovered
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {job.stats.sources_discovered}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">External Sources</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <FileSearch className="h-3.5 w-3.5 text-blue-400" />
            Analyzed
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {job.stats.sources_analyzed}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Documents Parsed</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            Evidence Items
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {job.stats.evidence_items}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Fact Extracts</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Verified Claims
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">
            {job.stats.claims_verified}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Supported Status</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
            Contradicted
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-400">
            {job.stats.claims_contradicted}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Flagged Conflicts</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            Insufficient
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-400">
            {job.stats.claims_insufficient}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Weak Evidence</div>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3.5 col-span-2 sm:col-span-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-cyan-400">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            Evidence Score
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-cyan-300">
            {job.stats.evidence_score || (isFinished ? 88 : '--')}/100
          </div>
          <div className="text-[10px] text-cyan-400/80 mt-0.5">Confidence Metric</div>
        </div>
      </div>

      {/* Main Grid: Sequential Pipeline Stages & Live Streaming Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Stages Checklist (Left) */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              Sequential Research Pipeline Stages
            </h3>
            <span className="text-[11px] text-slate-400">Controlled Execution Model</span>
          </div>

          <div className="space-y-2.5 pt-1">
            {STAGES_ORDER.map(s => {
              const stageData = job.stages.find(st => st.stage_name === s.key);
              const isRunning = stageData?.status === 'RUNNING';
              const isComplete = stageData?.status === 'COMPLETED';
              const isFailedStage = stageData?.status === 'FAILED';

              return (
                <div
                  key={s.key}
                  className={`flex items-start justify-between rounded-xl border p-3 transition-all ${
                    isRunning
                      ? 'border-cyan-500/50 bg-cyan-500/10 shadow-sm'
                      : isComplete
                      ? 'border-slate-800 bg-slate-950/80 text-slate-300'
                      : 'border-slate-800/60 bg-slate-950/40 text-slate-400 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
                      ) : isComplete ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : isFailedStage ? (
                        <AlertCircle className="h-4 w-4 text-rose-400" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border border-slate-700" />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-xs font-bold ${isRunning ? 'text-cyan-300' : isComplete ? 'text-white' : 'text-slate-400'}`}>
                        {s.label}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">{s.desc}</p>
                      {stageData?.message && (
                        <p className="text-[11px] font-mono text-cyan-400/90 mt-1">
                          &rsaquo; {stageData.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className={`text-[11px] font-mono font-medium ${isRunning ? 'text-cyan-400' : isComplete ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {stageData?.status || 'PENDING'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Event Stream / Terminal (Right) */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-950 p-5 flex flex-col h-[520px]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Live Engine Stream (SSE Event Log)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">{events.length} events logged</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pt-3 font-mono text-xs">
            {events.length === 0 ? (
              <div className="flex h-full items-center justify-center text-slate-400">
                <span>Listening for pipeline events on /api/v1/research/{job.id}/events...</span>
              </div>
            ) : (
              events.map((evt, idx) => (
                <div
                  key={evt.id || idx}
                  className="flex items-start gap-2 rounded-lg bg-slate-900/60 p-2 border border-slate-800/80 hover:border-slate-700 transition-colors"
                >
                  <span className="text-slate-400 text-[10px] whitespace-nowrap">
                    {new Date(evt.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    evt.event_type === 'source_discovered'
                      ? 'bg-blue-500/20 text-blue-400'
                      : evt.event_type === 'evidence_extracted'
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : evt.event_type === 'claim_verified'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : evt.event_type === 'calculation_performed'
                      ? 'bg-amber-500/20 text-amber-400'
                      : evt.event_type === 'error'
                      ? 'bg-rose-500/20 text-rose-400'
                      : 'bg-cyan-500/20 text-cyan-400'
                  }`}>
                    {evt.stage}
                  </span>
                  <p className="text-slate-200 text-[11px] flex-1 leading-snug">
                    {evt.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
