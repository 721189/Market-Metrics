import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Compass,
  Search,
  Download,
  ScanText,
  FileCheck2,
  ShieldCheck,
  Sigma,
  Lightbulb,
  FileText,
} from 'lucide-react';

/**
 * The 9-stage evidence pipeline, mirrored 1:1 from the real ResearchProgress
 * stage order so the marketing hero is an honest depiction of the product.
 * Stages light up in sequence in a loop; a completed run draws a glowing
 * connector line. Respects the OS "reduce motion" setting (renders fully-lit,
 * static list).
 */
const STAGES = [
  { icon: Compass, label: 'Planning', detail: 'Objectives & query families' },
  { icon: Search, label: 'Source Discovery', detail: 'Tier A–D search hierarchy' },
  { icon: Download, label: 'Safe Fetching', detail: 'SSRF guard & parsing' },
  { icon: ScanText, label: 'Extraction', detail: 'Facts + exact offsets' },
  { icon: FileCheck2, label: 'Claims', detail: 'Typed, evidence-bound' },
  { icon: ShieldCheck, label: 'Verification', detail: 'Contradiction audit' },
  { icon: Sigma, label: 'Analysis', detail: 'CAGR, TAM, unit economics' },
  { icon: Lightbulb, label: 'Synthesis', detail: 'Implications & trade-offs' },
  { icon: FileText, label: 'Report', detail: 'Traceable citations' },
] as const;

export const PipelineVisual: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      setActive(STAGES.length - 1);
      setDone(true);
      return;
    }
    if (done) {
      // Hold the finished state, then reset and loop.
      const hold = setTimeout(() => {
        setDone(false);
        setActive(0);
      }, 2600);
      return () => clearTimeout(hold);
    }
    const step = setTimeout(() => {
      setActive((prev) => {
        if (prev >= STAGES.length - 1) {
          setDone(true);
          return prev;
        }
        return prev + 1;
      });
    }, 900);
    return () => clearTimeout(step);
  }, [active, done, reduceMotion]);

  return (
    <div className="relative">
      {/* Glowing connector line */}
      <div className="absolute left-[19px] top-2 bottom-2 w-px bg-slate-800" aria-hidden />
      <motion.div
        className="absolute left-[19px] top-2 w-px bg-gradient-to-b from-cyan-400 to-blue-500"
        aria-hidden
        initial={{ height: 0 }}
        animate={{
          height: `${((active + (done ? 1 : 0)) / STAGES.length) * 100}%`,
        }}
        transition={{ duration: reduceMotion ? 0 : 0.6, ease: 'easeOut' }}
        style={{ boxShadow: '0 0 12px 2px rgba(34,211,238,0.55)' }}
      />

      <ol className="relative space-y-3">
        {STAGES.map((stage, i) => {
          const isActive = i === active && !done;
          const isComplete = i < active || done;
          const Icon = stage.icon;
          return (
            <motion.li
              key={stage.label}
              className="flex items-center gap-3"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: i <= active ? 1 : 0.45, x: 0 }}
              transition={{ duration: 0.3, delay: reduceMotion ? 0 : i * 0.04 }}
            >
              <span
                className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                  isActive
                    ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
                    : isComplete
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                    : 'border-slate-800 bg-slate-900 text-slate-600'
                }`}
                style={
                  isActive
                    ? { boxShadow: '0 0 0 4px rgba(34,211,238,0.12)' }
                    : undefined
                }
              >
                {isActive && !reduceMotion ? (
                  <motion.span
                    className="absolute inset-0 rounded-xl border border-cyan-400/60"
                    animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.35, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                  />
                ) : null}
                <Icon className="relative h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              </span>
              <div className="min-w-0">
                <div
                  className={`text-sm font-semibold ${
                    isComplete || isActive ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {stage.label}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{stage.detail}</div>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
};
