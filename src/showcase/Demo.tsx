import React from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  FileSearch,
  Quote as QuoteIcon,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Layers,
  TrendingUp,
} from 'lucide-react';
import { AnimatedNumber } from '../components/motion.js';
import { DEMO_REPORT } from './demoData.js';
import type { Page } from './router.js';

/**
 * Public interactive demo. Renders a realistic sample report (DEMO_REPORT) using
 * the same field shape as live output, but WITHOUT the authenticated viewer —
 * it is a marketing surface, so it is self-contained and read-only. The point is
 * to let a prospect click into a claim and see the evidence/provenance contract
 * before they ever sign up.
 */

interface DemoProps {
  navigate: (page: Page) => void;
}

const STATUS_STYLE: Record<string, string> = {
  SUPPORTED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CORROBORATED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CONTRADICTED: 'bg-red-500/10 text-red-400 border-red-500/20',
  INSUFFICIENT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

function statusClass(status: string): string {
  return STATUS_STYLE[status] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

export const Demo: React.FC<DemoProps> = ({ navigate }) => {
  const report = DEMO_REPORT;
  const score = report.evidence_score_breakdown;

  // Pick a few citation-bound claims across types to feature.
  const featuredClaims = report.claims.slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300">
          <Sparkles className="h-3.5 w-3.5" />
          Interactive sample dossier
        </span>
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          {report.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span><strong className="text-slate-300">Geography:</strong> {report.geography}</span>
          <span>&bull;</span>
          <span><strong className="text-slate-300">Horizon:</strong> {report.time_horizon}</span>
          <span>&bull;</span>
          <span><strong className="text-slate-300">Generated:</strong> {new Date(report.generated_at).toLocaleDateString()}</span>
        </div>
      </motion.div>

      {/* Evidence score + summary */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-cyan-500/10 to-slate-900/40 p-6"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-cyan-300">
            <CheckCircle2 className="h-4 w-4" />
            Evidence Score
          </div>
          <div className="mt-3 text-5xl font-extrabold font-mono text-cyan-300">
            <AnimatedNumber value={score.overall_score} />
            <span className="text-2xl text-cyan-400/70">/100</span>
          </div>
          <div className="mt-4 space-y-1.5 text-[11px]">
            {[
              ['Source quality', `${score.source_quality_score}/20`],
              ['Relevance', `${score.evidence_relevance_score}/20`],
              ['Directness', `${score.directness_score}/15`],
              ['Corroboration', `${score.corroboration_score}/15`],
              ['Recency', `${score.recency_score}/10`],
              ['Consistency', `${score.consistency_score}/10`],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-slate-400">{label}</span>
                <span className="font-mono font-semibold text-slate-200">{val}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
        >
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Layers className="h-4 w-4 text-cyan-400" />
            Executive Summary
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            {report.executive_summary}
          </p>
        </motion.div>
      </div>

      {/* Market metrics strip */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.4 }}
        className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        {report.market_metrics.slice(0, 4).map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
              {m.metric_name}
            </div>
            <div className="mt-2 font-mono text-lg font-bold text-white">{m.value}</div>
            <div className="mt-1 text-[10px] text-slate-500">{m.unit}</div>
          </div>
        ))}
      </motion.div>

      {/* Citation-bound claims */}
      <section className="mt-12">
        <div className="flex items-center gap-2">
          <QuoteIcon className="h-5 w-5 text-cyan-400" />
          <h2 className="text-xl font-bold text-white">Every claim is citation-bound</h2>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Click a claim to see the exact quote and byte offset it was extracted from.
          Contradictions are flagged, never averaged away.
        </p>

        <div className="mt-6 space-y-4">
          {featuredClaims.map((claim, i) => {
            const evidence = claim.supporting_evidence?.[0];
            return (
              <motion.div
                key={claim.id}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.35, delay: i * 0.06 }}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-cyan-400">[{claim.citation_number}]</span>
                      <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                        {claim.claim_type.replace('_', ' ')}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${statusClass(claim.verification_status)}`}>
                        {claim.verification_status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium leading-relaxed text-slate-100">
                      {claim.statement}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-2xl font-bold text-cyan-300">
                      {claim.confidence}%
                    </div>
                    <div className="text-[10px] text-slate-500">confidence</div>
                  </div>
                </div>

                {evidence && (
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Provenance &bull; exact text match
                    </div>
                    <blockquote className="mt-2 border-l-2 border-cyan-500/40 pl-3 text-[13px] italic leading-relaxed text-slate-300">
                      “{evidence.provenance.quote}”
                    </blockquote>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500">
                      <span className="font-mono">
                        offset {evidence.provenance.start_offset}–{evidence.provenance.end_offset}
                      </span>
                      <a
                        href={evidence.provenance.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
                      >
                        {new URL(evidence.provenance.source_url).hostname}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Demo notice + CTA */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.4 }}
        className="mt-12 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-200/80">
          This is an illustrative sample to showcase the output contract. Live reports
          are generated on demand against real, fetched sources — run your own to see
          your market analyzed with the same traceability.
        </p>
      </motion.div>

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          onClick={() => navigate('pricing')}
          className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 active:scale-[0.98] cursor-pointer"
        >
          See pricing
        </button>
        <a
          href="/app"
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          <FileSearch className="h-4 w-4" />
          Run your own research
        </a>
      </div>
    </div>
  );
};

