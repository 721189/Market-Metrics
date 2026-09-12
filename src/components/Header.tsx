import React from 'react';
import { 
  Search, 
  Layers, 
  ShieldCheck, 
  FileText, 
  Download, 
  Plus, 
  Database,
  Sparkles,
  BarChart3,
  Cpu
} from 'lucide-react';
import type { FullResearchReport, ResearchJob } from '../types.js';

interface HeaderProps {
  currentJob: ResearchJob | null;
  report: FullResearchReport | null;
  onNewResearch: () => void;
  onSelectBenchmark: (benchmarkId: string) => void;
  activeView: 'report' | 'evidence' | 'sources' | 'progress';
  setActiveView: (view: 'report' | 'evidence' | 'sources' | 'progress') => void;
  onExportJson: () => void;
  onPrintReport: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentJob,
  report,
  onNewResearch,
  onSelectBenchmark,
  activeView,
  setActiveView,
  onExportJson,
  onPrintReport,
}) => {
  const isJobRunning = currentJob && currentJob.status !== 'COMPLETED' && currentJob.status !== 'FAILED' && currentJob.status !== 'CANCELLED';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-white sm:text-lg">Market Research Agent</span>
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-400 border border-cyan-500/20">V2</span>
            </div>
            <p className="hidden text-xs text-slate-400 sm:block">Evidence-Backed Market Intelligence Engine</p>
          </div>
        </div>

        {/* Navigation View Switcher */}
        {report && (
          <div className="flex items-center rounded-lg bg-slate-900/90 p-1 border border-slate-800 text-xs">
            <button
              onClick={() => setActiveView('report')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                activeView === 'report'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Report
            </button>
            <button
              onClick={() => setActiveView('evidence')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                activeView === 'evidence'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Evidence & Claims ({report.claims.length})
            </button>
            <button
              onClick={() => setActiveView('sources')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                activeView === 'sources'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="h-3.5 w-3.5" />
              Sources ({report.sources.length})
            </button>
            {isJobRunning && (
              <button
                onClick={() => setActiveView('progress')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                  activeView === 'progress'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm font-semibold'
                    : 'text-amber-400 hover:text-amber-300 animate-pulse'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Live Pipeline
              </button>
            )}
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {report && (
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                onClick={onPrintReport}
                title="Print / Save as PDF"
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Export PDF
              </button>
              <button
                onClick={onExportJson}
                title="Download Structured Report JSON"
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                JSON
              </button>
            </div>
          )}

          {/* New Research Action */}
          <button
            onClick={onNewResearch}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-md shadow-cyan-500/20 hover:brightness-110 active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Research</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>
    </header>
  );
};
