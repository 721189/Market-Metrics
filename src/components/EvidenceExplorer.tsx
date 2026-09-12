import React, { useState } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Search, 
  Filter, 
  ExternalLink, 
  FileText, 
  Layers, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Hash,
  Database,
  Info
} from 'lucide-react';
import type { FullResearchReport, Claim, VerificationStatus, ClaimType } from '../types.js';

interface EvidenceExplorerProps {
  report: FullResearchReport;
  onInspectClaim?: (claim: Claim) => void;
}

export const EvidenceExplorer: React.FC<EvidenceExplorerProps> = ({
  report,
  onInspectClaim,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const claimTypes: ClaimType[] = [
    'MARKET_SIZE',
    'MARKET_GROWTH',
    'COMPETITOR',
    'PRICING',
    'CUSTOMER',
    'REGULATION',
    'TECHNOLOGY',
    'FINANCIAL',
    'STRATEGIC',
  ];

  const filteredClaims = report.claims.filter(claim => {
    if (selectedStatus !== 'ALL' && claim.verification_status !== selectedStatus) return false;
    if (selectedType !== 'ALL' && claim.claim_type !== selectedType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        claim.statement.toLowerCase().includes(q) ||
        claim.reasoning.toLowerCase().includes(q) ||
        claim.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Claim-Level Provenance & Evidence Explorer</h1>
            <p className="text-xs text-slate-400">
              Audit the chain of verification: Statement &rarr; Claim ID &rarr; Extracted Evidence (Offsets) &rarr; Discovered Source
            </p>
          </div>
        </div>
      </div>

      {/* Filter HUD */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4 sm:grid-cols-12">
        {/* Search Input */}
        <div className="relative sm:col-span-6">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search verified assertions, metrics, competitors..."
            className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        {/* Status Filter */}
        <div className="sm:col-span-3">
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Verification Statuses ({report.claims.length})</option>
            <option value="SUPPORTED">SUPPORTED ({report.claims.filter(c => c.verification_status === 'SUPPORTED').length})</option>
            <option value="PARTIALLY_SUPPORTED">PARTIALLY_SUPPORTED</option>
            <option value="CONTRADICTED">CONTRADICTED</option>
            <option value="INSUFFICIENT">INSUFFICIENT</option>
          </select>
        </div>

        {/* Claim Type Filter */}
        <div className="sm:col-span-3">
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Claim Types</option>
            {claimTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Claims Grid */}
      <div className="space-y-4">
        {filteredClaims.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400">
            <p className="text-sm">No claims match the selected filters.</p>
          </div>
        ) : (
          filteredClaims.map(claim => {
            const supportingEvidence = report.evidence_pool.filter(e =>
              claim.supporting_evidence_ids.includes(e.id)
            );

            return (
              <div
                key={claim.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4 hover:border-slate-700 transition-colors"
              >
                {/* Top Badge Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/20">
                      [{claim.citation_number || claim.id}]
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                      {claim.claim_type}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{claim.id}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Confidence:</span>
                      <span className="font-mono font-bold text-cyan-400">{claim.confidence}/100</span>
                    </div>

                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      claim.verification_status === 'SUPPORTED'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : claim.verification_status === 'CONTRADICTED'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {claim.verification_status}
                    </span>
                  </div>
                </div>

                {/* Statement */}
                <div>
                  <h3 className="text-base font-bold text-white leading-relaxed">
                    "{claim.statement}"
                  </h3>
                  <p className="mt-2 text-xs text-slate-300 bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                    <strong className="text-slate-400">Model D Audit:</strong> {claim.reasoning}
                  </p>
                </div>

                {/* Linked Primary Evidence Snippets */}
                <div className="space-y-2 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-emerald-400" />
                    Corroborating Primary Evidence Extracts ({supportingEvidence.length})
                  </span>

                  <div className="grid grid-cols-1 gap-2.5">
                    {supportingEvidence.map(ev => {
                      const source = report.sources.find(s => s.id === ev.source_id);
                      return (
                        <div
                          key={ev.id}
                          className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span className="font-mono text-cyan-400 font-medium">
                              Extract ID: {ev.id} &bull; {ev.section}
                            </span>
                            <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-400 border border-slate-800">
                              Character Offsets: {ev.start_offset} &ndash; {ev.end_offset}
                            </span>
                          </div>

                          <blockquote className="rounded border-l-2 border-emerald-500 bg-slate-900/60 p-2.5 font-mono text-[11px] italic text-slate-200">
                            "{ev.quote}"
                          </blockquote>

                          {source && (
                            <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[11px]">
                              <div className="flex items-center gap-2 truncate max-w-[450px]">
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                  source.source_type === 'TIER_A' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {source.source_type}
                                </span>
                                <span className="text-slate-300 truncate">{source.publisher}</span>
                              </div>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-semibold"
                              >
                                Source Record <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
