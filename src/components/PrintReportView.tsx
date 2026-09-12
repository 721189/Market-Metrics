import React from 'react';
import { 
  Printer, 
  ArrowLeft, 
  ShieldCheck, 
  Globe, 
  Calendar, 
  Award,
  Layers,
  FileText
} from 'lucide-react';
import type { FullResearchReport } from '../types.js';
import { FinancialEngine } from '../server/financial.js';

interface PrintReportViewProps {
  report: FullResearchReport;
  onBack: () => void;
}

export const PrintReportView: React.FC<PrintReportViewProps> = ({ report, onBack }) => {
  return (
    <div className="bg-white text-slate-900 min-h-screen font-sans">
      {/* Non-printed Top Toolbar */}
      <div className="no-print sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-6 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-black transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Interactive Explorer
        </button>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-all shadow-sm"
        >
          <Printer className="h-4 w-4" />
          Print / Save PDF
        </button>
      </div>

      {/* Printable Report Canvas */}
      <div className="max-w-4xl mx-auto p-8 sm:p-12 space-y-8">
        {/* Title Header */}
        <div className="border-b-2 border-slate-900 pb-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
            <span>MARKET RESEARCH INTELLIGENCE &bull; V2</span>
            <span>DATE: {new Date(report.generated_at).toLocaleDateString()}</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            {report.title}
          </h1>
          <p className="text-sm text-slate-700 font-medium">
            <strong>Target Query:</strong> {report.question}
          </p>
          <div className="flex gap-6 text-xs text-slate-600">
            <span><strong>Industry:</strong> {report.industry}</span>
            <span><strong>Geography:</strong> {report.geography}</span>
            <span><strong>Time Horizon:</strong> {report.time_horizon}</span>
            <span><strong>Overall Evidence Score:</strong> {report.evidence_score_breakdown.overall_score}/100</span>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            1. Executive Summary & Addressable Market
          </h2>
          <p className="text-sm text-slate-800 leading-relaxed">
            {report.executive_summary}
          </p>
          {report.sections[0] && (
            <p className="text-sm text-slate-800 leading-relaxed">
              {report.sections[0].content}
            </p>
          )}
        </div>

        {/* Market Sizing & Financial Model */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            2. Market Sizing & Deterministic Financial Projections
          </h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="border border-slate-300 p-3 rounded">
              <span className="text-xs text-slate-500 block uppercase">2030 TAM Forecast</span>
              <span className="text-xl font-bold font-mono text-slate-900">
                {FinancialEngine.formatCurrency(report.financial_models.tam_forecast, report.financial_models.currency)}
              </span>
            </div>
            <div className="border border-slate-300 p-3 rounded">
              <span className="text-xs text-slate-500 block uppercase">Verified CAGR</span>
              <span className="text-xl font-bold font-mono text-slate-900">
                {report.financial_models.cagr_pct}%
              </span>
            </div>
            <div className="border border-slate-300 p-3 rounded">
              <span className="text-xs text-slate-500 block uppercase">Year 3 SOM</span>
              <span className="text-xl font-bold font-mono text-slate-900">
                {FinancialEngine.formatCurrency(report.financial_models.som, report.financial_models.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Competitor Matrix */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            3. Competitive Landscape Matrix
          </h2>
          <table className="w-full text-xs text-left border border-slate-300">
            <thead className="bg-slate-100 border-b border-slate-300">
              <tr>
                <th className="p-2.5">Competitor</th>
                <th className="p-2.5">Position</th>
                <th className="p-2.5">Pricing Model</th>
                <th className="p-2.5">Target Customer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.competitors.map(c => (
                <tr key={c.id}>
                  <td className="p-2.5 font-bold">{c.name}</td>
                  <td className="p-2.5">{c.market_position}</td>
                  <td className="p-2.5">{c.pricing_summary}</td>
                  <td className="p-2.5">{c.target_customer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Customer Segments */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            4. Customer Segments & Buying Criteria
          </h2>
          <div className="space-y-2">
            {report.customer_segments.map(s => (
              <div key={s.id} className="border border-slate-300 p-3 rounded text-xs space-y-1">
                <div className="flex justify-between font-bold text-sm">
                  <span>{s.name} ({s.segment_type})</span>
                  <span>TAM Share: {s.estimated_tam_share_pct}% | WTP: {s.willingness_to_pay}</span>
                </div>
                <p className="text-slate-700">{s.description}</p>
                <div className="text-slate-600 pt-1">
                  <strong>Pain Points:</strong> {s.pain_points.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Strategic Recommendations */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            5. Strategic Recommendations & GTM Roadmap
          </h2>
          <div className="space-y-2">
            {report.recommendations.map(r => (
              <div key={r.id} className="border-l-4 border-slate-900 pl-3 py-1 text-xs">
                <div className="font-bold text-sm text-slate-900">
                  {r.title} ({r.priority} &bull; {r.timeframe})
                </div>
                <p className="text-slate-700 mt-1">{r.rationale}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Provenance & Citation Appendix */}
        <div className="space-y-3 pt-6 border-t-2 border-slate-900">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            6. Provenance & Verified Claims Appendix
          </h2>
          <div className="space-y-2 text-xs font-mono">
            {report.claims.map(c => (
              <div key={c.id} className="p-2 border border-slate-200 rounded">
                <span className="font-bold">[{c.citation_number || c.id}]</span> "{c.statement}" &bull; <span className="font-bold text-slate-700">{c.verification_status} ({c.confidence}/100)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sources Appendix */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide border-b border-slate-300 pb-1">
            7. Discovered Source Registries
          </h2>
          <ul className="list-decimal list-inside text-xs text-slate-700 space-y-1">
            {report.sources.map(s => (
              <li key={s.id}>
                <strong>[{s.source_type}]</strong> {s.title} &mdash; <em>{s.publisher}</em> ({s.url})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
