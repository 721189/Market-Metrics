import React from 'react';
import { 
  X, 
  ShieldCheck, 
  ExternalLink, 
  FileText, 
  AlertTriangle, 
  Database, 
  Sparkles,
  Layers,
  ArrowRight
} from 'lucide-react';
import type { Claim, Evidence, Source } from '../types.js';

interface CitationModalProps {
  claim: Claim | null;
  onClose: () => void;
  onViewSource?: (sourceId: string) => void;
}

export const CitationModal: React.FC<CitationModalProps> = ({
  claim,
  onClose,
  onViewSource,
}) => {
  if (!claim) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-bold font-mono text-sm">
              [{claim.citation_number || claim.id}]
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Provenance Chain Inspection</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  claim.verification_status === 'SUPPORTED'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : claim.verification_status === 'CONTRADICTED'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {claim.verification_status}
                </span>
              </div>
              <p className="text-xs text-slate-400">Claim ID: {claim.id} &bull; Type: {claim.claim_type}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Claim Statement & Confidence */}
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Asserted Claim Statement
          </label>
          <p className="mt-1 text-sm font-semibold text-white leading-relaxed">
            "{claim.statement}"
          </p>

          <div className="mt-3 flex items-center justify-between border-t border-slate-900 pt-3 text-xs">
            <span className="text-slate-400">Evidence Confidence:</span>
            <div className="flex items-center gap-2">
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-cyan-500"
                  style={{ width: `${claim.confidence}%` }}
                />
              </div>
              <span className="font-mono font-bold text-cyan-400">{claim.confidence}/100</span>
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
            <strong className="text-slate-300">Model D Verification Reasoning:</strong> {claim.reasoning}
          </div>
        </div>

        {/* Supporting Evidence Chain */}
        <div className="mt-5 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Supporting Primary Evidence ({claim.supporting_evidence?.length || claim.supporting_evidence_ids.length})
          </label>

          {claim.supporting_evidence && claim.supporting_evidence.length > 0 ? (
            claim.supporting_evidence.map(ev => (
              <div
                key={ev.id}
                className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-mono font-medium text-emerald-400">
                    Evidence ID: {ev.id} &bull; {ev.section}
                  </span>
                  <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300 border border-slate-800">
                    Offset: {ev.start_offset} - {ev.end_offset}
                  </span>
                </div>

                <blockquote className="rounded-lg border-l-2 border-emerald-400 bg-slate-950/80 p-3 text-slate-200 italic font-mono text-[11px] leading-relaxed">
                  "{ev.quote}"
                </blockquote>

                {ev.source && (
                  <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-300 truncate max-w-[340px]">
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                        ev.source.source_type === 'TIER_A' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {ev.source.source_type}
                      </span>
                      <span className="truncate">{ev.source.publisher || ev.source.domain}</span>
                    </div>
                    <a
                      href={ev.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 font-semibold text-cyan-400 hover:text-cyan-300"
                    >
                      Visit Source <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
              Linked evidence IDs: {claim.supporting_evidence_ids.join(', ')}
            </div>
          )}
        </div>

        {/* Contradicting Evidence if any */}
        {claim.contradicting_evidence_ids.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-400 mb-1">
              <AlertTriangle className="h-4 w-4" />
              Contradiction / Variance Audit
            </div>
            <p className="text-slate-300">
              Model D identified variances in external reporting regarding this metric. Contextual disambiguation resolved time/unit definitions.
            </p>
          </div>
        )}

        {/* Close */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
