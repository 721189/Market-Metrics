import React, { useState } from 'react';
import { 
  Calculator, 
  TrendingUp, 
  DollarSign, 
  Percent, 
  Clock, 
  HelpCircle,
  Sparkles,
  Layers,
  Activity,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { FinancialEngine } from '../server/financial.js';

interface FinancialCalculatorProps {
  initialArpu?: number;
  initialCac?: number;
  initialMargin?: number;
  currency?: string;
  tamCurrent?: number;
  tamForecast?: number;
  cagr?: number;
}

export const FinancialCalculator: React.FC<FinancialCalculatorProps> = ({
  initialArpu = 4800,
  initialCac = 3800,
  initialMargin = 78,
  currency = 'USD',
  tamCurrent = 450000000,
  tamForecast = 2450000000,
  cagr = 28.4,
}) => {
  const [arpu, setArpu] = useState<number>(initialArpu);
  const [cac, setCac] = useState<number>(initialCac);
  const [grossMargin, setGrossMargin] = useState<number>(initialMargin);
  const [churnRate, setChurnRate] = useState<number>(7.5);
  const [targetMarketShare, setTargetMarketShare] = useState<number>(4.5);

  // Deterministic Unit Economics calculation
  const economics = FinancialEngine.calculateUnitEconomics({
    arpu_annual: arpu,
    gross_margin_pct: grossMargin,
    annual_churn_rate_pct: churnRate,
    cac: cac,
    sales_cycle_months: 2.8,
  });

  const scenarios = FinancialEngine.generateScenarios(arpu, cac, grossMargin, currency);
  const monteCarlo = FinancialEngine.calculateMonteCarloRange(tamCurrent, cagr, 5);

  const formatCurr = (amount: number) => FinancialEngine.formatCurrency(amount, currency);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white">Deterministic Financial & Sensitivity Engine</h3>
            <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20">
              Deterministic Formulas
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Formulas: LTV = (ARPU &times; Gross Margin) / Churn &bull; Payback = CAC / (Monthly Gross Margin)
          </p>
        </div>
      </div>

      {/* Input Sliders */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Annual Contract Value (ARPU)</span>
            <span className="font-mono font-bold text-cyan-400">
              {formatCurr(arpu)}
            </span>
          </div>
          <input
            type="range"
            min={currency === 'INR' ? 5000 : 500}
            max={currency === 'INR' ? 200000 : 25000}
            step={currency === 'INR' ? 1000 : 100}
            value={arpu}
            onChange={e => setArpu(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Customer Acquisition Cost (CAC)</span>
            <span className="font-mono font-bold text-cyan-400">
              {formatCurr(cac)}
            </span>
          </div>
          <input
            type="range"
            min={currency === 'INR' ? 2000 : 200}
            max={currency === 'INR' ? 100000 : 15000}
            step={currency === 'INR' ? 500 : 50}
            value={cac}
            onChange={e => setCac(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Software Gross Margin</span>
            <span className="font-mono font-bold text-emerald-400">{grossMargin}%</span>
          </div>
          <input
            type="range"
            min={40}
            max={95}
            step={1}
            value={grossMargin}
            onChange={e => setGrossMargin(Number(e.target.value))}
            className="w-full accent-emerald-400 cursor-pointer"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Annual Logo Churn Rate</span>
            <span className="font-mono font-bold text-amber-400">{churnRate}%</span>
          </div>
          <input
            type="range"
            min={2}
            max={25}
            step={0.5}
            value={churnRate}
            onChange={e => setChurnRate(Number(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer"
          />
        </div>
      </div>

      {/* Real-time Computed Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-xl border border-cyan-500/20 bg-slate-950 p-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Customer Lifetime Value
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-cyan-400 font-mono">
              {formatCurr(economics.ltv)}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">(ARPU &times; {grossMargin}%) &divide; {churnRate}%</span>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-slate-950 p-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            LTV : CAC Ratio
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-xl font-black font-mono ${economics.ltv_to_cac >= 4 ? 'text-emerald-400' : economics.ltv_to_cac >= 3 ? 'text-cyan-400' : 'text-amber-400'}`}>
              {economics.ltv_to_cac}x
            </span>
            <span className="text-[10px] text-emerald-400 font-semibold">
              {economics.ltv_to_cac >= 5 ? 'Top Quartile' : economics.ltv_to_cac >= 3 ? 'Healthy' : 'Sub-Optimal'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">Benchmark: &gt;3.0x</span>
        </div>

        <div className="rounded-xl border border-indigo-500/20 bg-slate-950 p-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            CAC Payback Period
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-indigo-400 font-mono">
              {economics.payback_period_months} mo
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">Months to recover CAC</span>
        </div>

        <div className="rounded-xl border border-purple-500/20 bg-slate-950 p-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Net Revenue Retention
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-purple-400 font-mono">
              {economics.net_revenue_retention_pct}%
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">Estimated annual retention</span>
        </div>

        <div className="col-span-2 sm:col-span-1 rounded-xl border border-blue-500/20 bg-slate-950 p-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Rule of 40 Index
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black text-blue-400 font-mono">
              {economics.rule_of_40_score}%
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">Growth + Operating Margin</span>
        </div>
      </div>

      {/* Scenario Breakdown Matrix */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-cyan-400" />
          3-Tier Financial Scenario Matrix
        </h4>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Conservative */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">Conservative Case</span>
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">P10</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">3-Year Revenue:</span>
                <span className="font-mono font-bold text-white">{formatCurr(scenarios.scenario_conservative.year_3_revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">LTV:CAC Ratio:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_conservative.ltv_to_cac}x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payback Period:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_conservative.payback_months} mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Gross Margin:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_conservative.gross_margin_pct}%</span>
              </div>
            </div>
          </div>

          {/* Base Case */}
          <div className="rounded-xl border border-cyan-500/40 bg-slate-950/90 p-4 space-y-3 shadow-lg shadow-cyan-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-400">Base Case (Target)</span>
              <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400">P50</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">3-Year Revenue:</span>
                <span className="font-mono font-bold text-cyan-400">{formatCurr(scenarios.scenario_base.year_3_revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">LTV:CAC Ratio:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_base.ltv_to_cac}x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payback Period:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_base.payback_months} mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Gross Margin:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_base.gross_margin_pct}%</span>
              </div>
            </div>
          </div>

          {/* Aggressive */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400">Aggressive Expansion</span>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">P90</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">3-Year Revenue:</span>
                <span className="font-mono font-bold text-emerald-400">{formatCurr(scenarios.scenario_aggressive.year_3_revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">LTV:CAC Ratio:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_aggressive.ltv_to_cac}x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payback Period:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_aggressive.payback_months} mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Gross Margin:</span>
                <span className="font-mono font-bold text-slate-200">{scenarios.scenario_aggressive.gross_margin_pct}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
