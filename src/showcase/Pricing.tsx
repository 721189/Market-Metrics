import React from 'react';
import { motion } from 'motion/react';
import { Check, Sparkles } from 'lucide-react';
import { AnimatedNumber } from '../components/motion.js';
import type { Page } from './router.js';

/**
 * Public pricing page. Three tiers positioned around the engine's actual cost
 * model (per-run LLM + fetch spend, governed by the CostGovernor). The numbers
 * are illustrative marketing figures, not a live Stripe integration — this is a
 * showcase surface.
 */

interface PricingProps {
  navigate: (page: Page) => void;
}

interface Tier {
  id: string;
  name: string;
  tagline: string;
  price: number;
  priceSuffix: string;
  highlight?: boolean;
  badge?: string;
  features: string[];
  cta: string;
}

const TIERS: Tier[] = [
  {
    id: 'analyst',
    name: 'Analyst',
    tagline: 'For solo researchers validating a single market.',
    price: 0,
    priceSuffix: 'forever',
    features: [
      '3 reports per month',
      'Standard research depth',
      'Evidence-first dossier + citations',
      'JSON & CSV export',
      'Community support',
    ],
    cta: 'Start free',
  },
  {
    id: 'professional',
    name: 'Professional',
    tagline: 'For teams shipping market intelligence continuously.',
    price: 79,
    priceSuffix: 'per seat / month',
    highlight: true,
    badge: 'Most popular',
    features: [
      'Unlimited reports',
      'Deep + exhaustive research depth',
      'Full traceability (provenance offsets)',
      'JSON, CSV & PDF dossier export',
      'TAM / SAM / SOM & unit-economics math',
      'Priority pipeline queue',
      'Email support',
    ],
    cta: 'Start 14-day trial',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For organizations that need governance and scale.',
    price: 349,
    priceSuffix: 'per seat / month',
    features: [
      'Everything in Professional',
      'SSO / SAML + audit logging',
      'Private source ingestion',
      'Custom evidence-scoring rubrics',
      'Dedicated pipeline capacity',
      'SOC 2 report & DPA',
      'Dedicated success manager',
    ],
    cta: 'Talk to sales',
  },
];

export const Pricing: React.FC<PricingProps> = ({ navigate }) => {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300">
          <Sparkles className="h-3.5 w-3.5" />
          Pricing
        </span>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Priced for the value of a
          <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent"> verified claim</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
          Every report is a traceable dossier you can defend in a board meeting —
          not a chatbot answer. Start free, upgrade when evidence becomes a habit.
        </p>

      <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {TIERS.map((tier, i) => (
          <motion.div
            key={tier.id}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.45, delay: i * 0.08 }}
            className={`relative flex flex-col rounded-3xl border p-7 ${
              tier.highlight
                ? 'border-cyan-500/40 bg-gradient-to-b from-cyan-500/10 to-slate-900/50 shadow-xl shadow-cyan-500/10 lg:-mt-3 lg:mb-3'
                : 'border-slate-800 bg-slate-900/40'
            }`}
          >
            {tier.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-950">
                {tier.badge}
              </span>
            )}

            <h2 className="text-lg font-bold text-white">{tier.name}</h2>
            <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-slate-400">{tier.tagline}</p>

            <div className="mt-5 flex items-end gap-1.5">
              <span className="text-5xl font-extrabold tracking-tight text-white">
                {tier.price === 0 ? '$0' : <><span className="text-3xl align-top">$</span><AnimatedNumber value={tier.price} /></>}
              </span>
              <span className="pb-1.5 text-xs font-medium text-slate-400">{tier.priceSuffix}</span>
            </div>

            <ul className="mt-7 space-y-3 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-slate-300">
                  <Check
                    className={`mt-0.5 h-4 w-4 shrink-0 ${tier.highlight ? 'text-cyan-400' : 'text-emerald-400'}`}
                  />
                  <span className="leading-relaxed">{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => navigate('contact')}
              className={`mt-8 w-full rounded-xl px-5 py-3 text-sm font-bold transition active:scale-[0.98] cursor-pointer ${
                tier.highlight
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-lg shadow-cyan-500/20 hover:brightness-110'
                  : 'border border-slate-700 bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {tier.cta}
            </button>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mt-12 text-center text-xs leading-relaxed text-slate-500"
      >
        All plans include the full evidence-first pipeline: real source discovery,
        exact-provenance citations, contradiction auditing, and deterministic
        market math. Annual billing saves 20%.
      </motion.p>
      </motion.div>
    </div>
  );
};
