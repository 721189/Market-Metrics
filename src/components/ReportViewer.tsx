import React, { useState, useMemo } from 'react';
import { 
  TrendingUp, 
  ShieldCheck, 
  Building2, 
  Users, 
  DollarSign, 
  FileText, 
  Layers, 
  AlertTriangle, 
  Lightbulb, 
  Scale, 
  Calendar, 
  Globe, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Award,
  CheckCircle2,
  Lock,
  ArrowUpRight,
  Search,
  Copy,
  Check,
  Download
} from 'lucide-react';
import type { FullResearchReport, Claim } from '../types.js';
import { FinancialCalculator } from './FinancialCalculator.js';
import { FinancialEngine } from '../server/financial.js';

interface ReportViewerProps {
  report: FullResearchReport;
  onInspectClaim: (claim: Claim) => void;
  onNavigateTab: (tab: 'report' | 'evidence' | 'sources') => void;
}

export const ReportViewer: React.FC<ReportViewerProps> = ({
  report,
  onInspectClaim,
  onNavigateTab,
}) => {
  const [activeSection, setActiveSection] = useState<string>('summary');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  // Helper to parse text and make citation pills interactive e.g. [1], [14]
  const renderInteractiveText = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const citationNum = parseInt(match[1], 10);
        const claim = report.claims.find(c => c.citation_number === citationNum);
        if (claim) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onInspectClaim(claim)}
              title={`Inspect Provenance for Claim #${citationNum}: "${claim.statement}"`}
              className="inline-flex items-center justify-center font-mono font-bold text-[11px] text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 rounded px-1.5 py-0.5 mx-0.5 hover:bg-cyan-500 hover:text-slate-950 transition-all cursor-pointer shadow-xs align-baseline"
            >
              [{citationNum}]
            </button>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  const handleCopySummary = () => {
    const content = `${report.title}\n\nExecutive Summary:\n${report.executive_summary}\n\nVerified Evidence Score: ${report.evidence_score_breakdown.overall_score}/100\nForecast TAM: ${FinancialEngine.formatCurrency(report.financial_models.tam_forecast, report.financial_models.currency)} (${report.financial_models.cagr_pct}% CAGR)`;
    navigator.clipboard.writeText(content);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  // Filter competitors based on search
  const filteredCompetitors = useMemo(() => {
    if (!searchQuery.trim()) return report.competitors;
    const q = searchQuery.toLowerCase();
    return report.competitors.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.description.toLowerCase().includes(q) ||
      c.target_customer.toLowerCase().includes(q)
    );
  }, [report.competitors, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Report Header & Evidence Score Card */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400 border border-cyan-500/20">
                Market Intelligence Report &bull; V2
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Generated: {new Date(report.generated_at).toLocaleDateString()}
              </span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
              {report.title}
            </h1>
            <p className="text-sm text-slate-300">
              <strong className="text-white">Research Target:</strong> {report.question}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
              <span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5 text-cyan-400" /> {report.geography}</span>
              <span>&bull;</span>
              <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5 text-blue-400" /> {report.industry}</span>
              <span>&bull;</span>
              <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5 text-indigo-400" /> {report.time_horizon}</span>
            </div>
          </div>

          {/* Evidence Score Card */}
          <div className="rounded-xl border border-cyan-500/30 bg-slate-950 p-5 lg:min-w-[280px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Overall Evidence Score
              </span>
              <Award className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold font-mono text-cyan-300">
                {report.evidence_score_breakdown.overall_score}
              </span>
              <span className="text-sm font-semibold text-slate-400">/ 100</span>
            </div>
            <div className="mt-3 space-y-1.5 text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span>Source Quality:</span>
                <span className="font-mono text-cyan-400">{report.evidence_score_breakdown.source_quality_score}/20</span>
              </div>
              <div className="flex justify-between">
                <span>Relevance & Directness:</span>
                <span className="font-mono text-cyan-400">{report.evidence_score_breakdown.evidence_relevance_score + report.evidence_score_breakdown.directness_score}/35</span>
              </div>
              <div className="flex justify-between">
                <span>Corroboration:</span>
                <span className="font-mono text-cyan-400">{report.evidence_score_breakdown.corroboration_score}/15</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Search & Export Utility Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search within report sections..."
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={handleCopySummary}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedSummary ? 'Copied to Clipboard!' : 'Copy Summary'}</span>
          </button>
          <a
            href={`/api/v1/research/${report.job_id}/export/csv`}
            download
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Main Grid: Sticky Section Nav & Content */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Navigation Sidebar */}
        <div className="lg:col-span-3 space-y-1">
          <div className="sticky top-20 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs space-y-1 font-medium">
            <div className="px-3 py-2 font-bold uppercase tracking-wider text-slate-400 text-[10px]">
              Report Navigation
            </div>
            {[
              { id: 'summary', label: '1. Executive Summary' },
              { id: 'sizing', label: '2. Market Sizing & CAGR' },
              { id: 'competitors', label: '3. Competitive Matrix' },
              { id: 'customers', label: '4. Customer Segments' },
              { id: 'pricing', label: '5. Pricing Benchmarks' },
              { id: 'financials', label: '6. Financial Scenarios' },
              { id: 'regulatory', label: '7. Regulation & Subsidies' },
              { id: 'risks', label: '8. Risks & Mitigations' },
              { id: 'recommendations', label: '9. Strategic Roadmap' },
            ].map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setActiveSection(item.id)}
                className={`block rounded-lg px-3 py-2 transition-all ${
                  activeSection === item.id
                    ? 'bg-cyan-500/10 text-cyan-400 font-semibold border-l-2 border-cyan-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {item.label}
              </a>
            ))}

            <div className="pt-3 border-t border-slate-800 mt-2">
              <button
                onClick={() => onNavigateTab('evidence')}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              >
                <span>Evidence Explorer ({report.claims.length})</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onNavigateTab('sources')}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors"
              >
                <span>Sources Directory ({report.sources.length})</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="lg:col-span-9 space-y-10">
          {/* 1. Executive Summary */}
          <section id="summary" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              <h2 className="text-xl font-bold text-white">1. Executive Summary & Synthesis</h2>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-slate-200 text-sm leading-relaxed space-y-4">
              <p>{renderInteractiveText(report.executive_summary)}</p>

              {report.sections.map(sec => (
                <div key={sec.id} className="pt-3 border-t border-slate-800 space-y-1.5">
                  <h3 className="font-bold text-cyan-300 text-sm">{sec.title}</h3>
                  <p className="text-slate-300 text-xs leading-relaxed">{renderInteractiveText(sec.content)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 2. Sizing & Deterministic CAGR */}
          <section id="sizing" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <TrendingUp className="h-5 w-5 text-blue-400" />
              <h2 className="text-xl font-bold text-white">2. Market Sizing & Deterministic CAGR</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1">
                <span className="text-xs font-medium text-slate-400">Total Addressable Market (Base)</span>
                <div className="text-2xl font-black text-white font-mono">
                  {FinancialEngine.formatCurrency(report.financial_models.tam_current, report.financial_models.currency)}
                </div>
                <span className="text-[11px] text-slate-400">Validated Year {report.financial_models.year_start}</span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1">
                <span className="text-xs font-medium text-slate-400">Deterministic Forecast ({report.financial_models.year_end})</span>
                <div className="text-2xl font-black text-cyan-400 font-mono">
                  {FinancialEngine.formatCurrency(report.financial_models.tam_forecast, report.financial_models.currency)}
                </div>
                <span className="text-[11px] text-emerald-400 font-semibold">
                  Verified CAGR: {report.financial_models.cagr_pct}%
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1">
                <span className="text-xs font-medium text-slate-400">Serviceable Market (SAM &bull; SOM)</span>
                <div className="text-2xl font-black text-blue-400 font-mono">
                  {FinancialEngine.formatCurrency(report.financial_models.som, report.financial_models.currency)}
                </div>
                <span className="text-[11px] text-slate-400">
                  Target Serviceable Obtainable Pool
                </span>
              </div>
            </div>
          </section>

          {/* 3. Competitor Matrix */}
          <section id="competitors" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Building2 className="h-5 w-5 text-indigo-400" />
              <h2 className="text-xl font-bold text-white">3. Competitive Intelligence Matrix</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {filteredCompetitors.map(comp => (
                <div
                  key={comp.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-3 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{comp.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          comp.market_position === 'LEADER'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : comp.market_position === 'CHALLENGER'
                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                            : 'bg-slate-800 text-slate-300'
                        }`}>
                          {comp.market_position}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{comp.description}</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs pt-2 border-t border-slate-800/80">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Target Segment:</span>
                      <span className="font-semibold text-slate-200">{comp.target_customer}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Observed Pricing:</span>
                      <span className="font-mono text-cyan-400">{comp.pricing_summary}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2">
                    <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/20 p-2.5">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                        Strengths
                      </span>
                      <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                        {comp.strengths.slice(0, 2).map((s, idx) => (
                          <li key={idx} className="truncate">{s}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg bg-rose-950/30 border border-rose-500/20 p-2.5">
                      <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block mb-1">
                        Weaknesses
                      </span>
                      <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                        {comp.weaknesses.slice(0, 2).map((w, idx) => (
                          <li key={idx} className="truncate">{w}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Customer Segments */}
          <section id="customers" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Users className="h-5 w-5 text-purple-400" />
              <h2 className="text-xl font-bold text-white">4. Customer Segments & Buying Criteria</h2>
            </div>

            <div className="space-y-3">
              {report.customer_segments.map(seg => (
                <div
                  key={seg.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{seg.name}</h3>
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                          {seg.segment_type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{seg.description}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">TAM Share:</span>
                      <span className="font-mono font-bold text-cyan-400">{seg.estimated_tam_share_pct}%</span>
                      <span className="text-slate-400 ml-2">WTP:</span>
                      <span className="font-bold text-emerald-400">{seg.willingness_to_pay}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-800">
                    <div>
                      <span className="font-semibold text-rose-400">Core Pain Points:</span>
                      <ul className="list-disc list-inside text-slate-300 mt-1 space-y-0.5">
                        {seg.pain_points.map((p, idx) => (
                          <li key={idx}>{p}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="font-semibold text-emerald-400">Key Buying Criteria:</span>
                      <ul className="list-disc list-inside text-slate-300 mt-1 space-y-0.5">
                        {seg.key_buying_criteria.map((c, idx) => (
                          <li key={idx}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 5. Pricing Tiers */}
          <section id="pricing" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <DollarSign className="h-5 w-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">5. Normalized Pricing Analysis</h2>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-[11px] font-semibold uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Tier Name</th>
                    <th className="px-4 py-3">Provider Benchmarks</th>
                    <th className="px-4 py-3">Normalized Rate</th>
                    <th className="px-4 py-3">Annualized</th>
                    <th className="px-4 py-3">Target Customer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {report.pricing_tiers.map((pt, i) => (
                    <tr key={i} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-semibold text-white">{pt.tier_name}</td>
                      <td className="px-4 py-3 text-slate-400">{pt.competitor_name}</td>
                      <td className="px-4 py-3 font-mono font-bold text-cyan-400">
                        {FinancialEngine.formatCurrency(pt.amount, pt.currency)}/{pt.unit.toLowerCase()}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {FinancialEngine.formatCurrency(pt.annualized_amount, pt.currency)}/yr
                      </td>
                      <td className="px-4 py-3 text-slate-300">{pt.target_segment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 6. Deterministic Financial Scenarios Engine */}
          <section id="financials" className="space-y-4">
            <FinancialCalculator
              initialArpu={report.financial_models.currency === 'INR' ? 48000 : 4800}
              initialCac={report.financial_models.currency === 'INR' ? 38000 : 3800}
              initialMargin={78}
              tamCurrent={report.financial_models.tam_current}
              tamForecast={report.financial_models.tam_forecast}
              cagr={report.financial_models.cagr_pct}
              currency={report.financial_models.currency}
            />
          </section>

          {/* 7. Regulatory Policies */}
          <section id="regulatory" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Scale className="h-5 w-5 text-amber-400" />
              <h2 className="text-xl font-bold text-white">7. Regulatory Framework & Subsidies</h2>
            </div>

            <div className="space-y-3">
              {report.regulatory_factors.map((reg, i) => (
                <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">{reg.policy_name}</h3>
                    <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                      {reg.authority}
                    </span>
                  </div>
                  <p className="text-slate-300">{reg.impact_summary}</p>
                  <div className="text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-slate-200">Compliance Requirement:</strong> {reg.compliance_req}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 8. Risks & Mitigations */}
          <section id="risks" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
              <h2 className="text-xl font-bold text-white">8. Strategic Risk Matrix & Mitigations</h2>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {report.risks.map(r => (
                <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                      {r.category}
                    </span>
                    <span className="text-[10px] font-bold text-rose-400">{r.impact} IMPACT</span>
                  </div>
                  <h4 className="font-bold text-white">{r.title}</h4>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    <strong className="text-slate-300">Mitigation:</strong> {r.mitigation}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 9. Strategic Recommendations */}
          <section id="recommendations" className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Lightbulb className="h-5 w-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-white">9. Strategic Roadmap & GTM Playbook</h2>
            </div>

            <div className="space-y-3">
              {report.recommendations.map(rec => (
                <div
                  key={rec.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20">
                        {rec.priority} PRIORITY
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                        {rec.timeframe}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-white">{rec.title}</h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <strong className="text-white">Rationale:</strong> {rec.rationale}
                  </p>

                  {rec.risk_factors.length > 0 && (
                    <div className="text-[11px] text-amber-300 bg-amber-950/20 border border-amber-500/20 p-2.5 rounded-lg">
                      <strong>Watch Outs:</strong> {rec.risk_factors.join('; ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
