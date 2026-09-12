import React from 'react';
import { 
  Database, 
  ExternalLink, 
  ShieldCheck, 
  Calendar, 
  Globe, 
  Lock, 
  CheckCircle2, 
  Hash,
  Award
} from 'lucide-react';
import type { FullResearchReport, Source } from '../types.js';

interface SourcesAppendixProps {
  report: FullResearchReport;
}

export const SourcesAppendix: React.FC<SourcesAppendixProps> = ({ report }) => {
  const tierACount = report.sources.filter(s => s.source_type === 'TIER_A').length;
  const tierBCount = report.sources.filter(s => s.source_type === 'TIER_B').length;
  const tierCCount = report.sources.filter(s => s.source_type === 'TIER_C').length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header & Hierarchy Guide */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Discovered Sources & Document Appendix</h1>
            <p className="text-xs text-slate-400">
              Validated external repositories, filings, and regulatory gazettes used in this report
            </p>
          </div>
        </div>

        {/* Source Hierarchy Distribution (Section 50) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2">
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">Tier A &bull; Primary / Official</span>
              <span className="font-mono text-lg font-bold text-white">{tierACount}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Government ministries, regulatory gazettes, SEC/MCA audited filings.</p>
          </div>

          <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-400">Tier B &bull; Research & Analyst</span>
              <span className="font-mono text-lg font-bold text-white">{tierBCount}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Established market research institutes, consultancies, academic studies.</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Tier C &bull; Industry Media</span>
              <span className="font-mono text-lg font-bold text-white">{tierCCount}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Trade journalism, executive press releases, tech publications.</p>
          </div>
        </div>
      </div>

      {/* Sources Table / List */}
      <div className="space-y-3">
        {report.sources.map(src => (
          <div
            key={src.id}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-3 hover:border-slate-700 transition-all"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                  src.source_type === 'TIER_A'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : src.source_type === 'TIER_B'
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'bg-slate-800 text-slate-300'
                }`}>
                  {src.source_type}
                </span>
                <h3 className="text-sm font-bold text-white">{src.title}</h3>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">Reliability Score:</span>
                <span className="font-mono font-bold text-cyan-400">{src.reliability_score}/100</span>
              </div>
            </div>

            <p className="text-xs text-slate-300">{src.snippet}</p>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
              <div className="flex flex-wrap items-center gap-4">
                <span><strong>Publisher:</strong> {src.publisher}</span>
                <span>&bull;</span>
                <span><strong>Domain:</strong> {src.domain}</span>
                <span>&bull;</span>
                <span><strong>Retrieved:</strong> {new Date(src.retrieved_at).toLocaleDateString()}</span>
                <span>&bull;</span>
                <span className="font-mono">Hash: {src.content_hash.substring(0, 16)}...</span>
              </div>

              <a
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-semibold text-cyan-400 hover:text-cyan-300"
              >
                Direct Web Source <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
