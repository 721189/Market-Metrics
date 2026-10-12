import React from 'react';
import { motion } from 'motion/react';
import {
  Radar,
  ShieldCheck,
  Zap,
  TrendingUp,
  Quote,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  FileSearch,
} from 'lucide-react';
import { AnimatedNumber } from '../components/motion.js';
import { PipelineVisual } from './PipelineVisual.js';
import type { Page } from './router.js';

interface LandingProps {
  navigate: (page: Page) => void;
}

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Evidence-First by Design',
    body: 'A nine-stage pipeline that separates the model from the evidence. Every claim is typed, corroborated, and tied to an exact quote with a byte offset — contradictions are audited, not averaged away.',
  },
  {
    icon: Zap,
    title: 'Hours, Not Weeks',
    body: 'What used to take an analyst team a fortnight to assemble, the engine produces in minutes — sourced, verified, and traceable end-to-end.',
  },
  {
    icon: TrendingUp,
    title: 'Deterministic Math',
    body: 'CAGR, TAM/SAM/SOM and unit economics are computed in code, never hallucinated. The model reasons over numbers; it never invents them.',
  },
];

const STATS = [
  { value: 9, suffix: '', label: 'Verification stages' },
  { value: 84, suffix: '/100', label: 'Median evidence score' },
  { value: 100, suffix: '%', label: 'Claims citation-bound' },
];

const STEPS = [
  { n: '01', title: 'Ask', body: 'Enter a market question, industry, geography and horizon.' },
  { n: '02', title: 'Discover & Fetch', body: 'The engine searches a tiered source hierarchy and safely parses documents.' },
  { n: '03', title: 'Verify', body: 'Facts become typed claims, then audited for contradictions and scored for evidence quality.' },
  { n: '04', title: 'Decide', body: 'You get a traceable dossier with TAM math and citations you can defend.' },
];

export const Landing: React.FC<LandingProps> = ({ navigate }) => {
  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Evidence-first market intelligence
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05 }}
              className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl"
            >
              Market research the{' '}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                model can't hallucinate.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.12 }}
              className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400"
            >
              Market-Metrics runs a nine-stage evidence pipeline — discover, fetch,
              extract, verify, compute, synthesize — so every number in your report
              is <span className="text-slate-200">sourced, scored, and citation-bound.</span>
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.18 }}
              className="mt-8 flex flex-col gap-3 sm:flex-row"
            >
              <button
                onClick={() => navigate('demo')}
                className="group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 cursor-pointer"
              >
                See a live report
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="/app"
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-6 py-3.5 text-sm font-bold text-white transition hover:border-slate-600 hover:bg-slate-900"
              >
                <Radar className="h-4 w-4 text-cyan-400" />
                Launch the app
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-6 flex items-center gap-2 text-xs text-slate-500"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              No credit card to explore the demo
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-2xl backdrop-blur-sm sm:p-7"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Evidence Pipeline
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                RUNNING
              </span>
            </div>
            <PipelineVisual />
          </motion.div>
        </div>
      </section>

      {/* STATS BAR */}
      <section className="border-y border-slate-800/60 bg-slate-900/30">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-10 sm:grid-cols-3 sm:px-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-extrabold font-mono text-cyan-300 sm:text-4xl">
                <AnimatedNumber value={s.value} />
                <span className="text-lg text-cyan-400/80">{s.suffix}</span>
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PILLARS */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Built for decisions you have to defend
          </h2>
          <p className="mt-4 text-slate-400">
            Not another chat window guessing at a market. A structured engine with a
            hard line between reasoning and evidence.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-cyan-500/40 hover:bg-slate-900/70"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10">
                <p.icon className="h-5 w-5 text-cyan-400" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-slate-800/60 bg-slate-900/20">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              From question to defensible dossier
            </h2>
            <p className="mt-4 text-slate-400">
              Four steps, no prompt engineering, no spreadsheet archaeology.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="relative rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <span className="font-mono text-3xl font-extrabold text-cyan-500/30">
                  {step.n}
                </span>
                <h3 className="mt-2 text-base font-bold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* QUOTE */}
      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
        <motion.figure
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-900/20 p-8 text-center sm:p-12"
        >
          <Quote className="mx-auto h-7 w-7 text-cyan-400/70" />
          <blockquote className="mt-5 text-xl font-medium leading-relaxed text-slate-200 sm:text-2xl">
            “Every number here traces back to a document and a byte offset. That is
            the difference between a market report I can put in front of the board
            and a chatbot transcript I cannot.”
          </blockquote>
          <figcaption className="mt-5 text-sm text-slate-500">
            Strategy lead, growth-stage B2B SaaS
          </figcaption>
        </motion.figure>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-900/40 to-blue-600/10 p-10 text-center sm:p-14"
          >
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl"
              aria-hidden
            />
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              See a real report, end to end
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">
              Explore the interactive demo of a full North-America AI-workflow
              market entry dossier — every claim citation-bound, every figure
              reproducible.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={() => navigate('demo')}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 active:scale-[0.98] cursor-pointer"
              >
                <FileSearch className="h-4 w-4" />
                Open the live demo
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href="/app"
                className="rounded-xl border border-slate-700 bg-slate-900/60 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                Run your own research
              </a>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
};
