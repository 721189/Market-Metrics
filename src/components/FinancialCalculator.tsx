import React, { useState } from 'react';
import { 
  Calculator, 
  TrendingUp, 
  DollarSign, 
  Percent, 
  Clock, 
  HelpCircle,
  Sparkles,
  Layers
} from 'lucide-react';
import { FinancialEngine } from '../server/financial.js';

interface FinancialCalculatorProps {
  initialArpu?: number;
  initialCac?: number;
  initialMargin?: number;
  currency?: string;
}

export const FinancialCalculator: React.FC<FinancialCalculatorProps> = ({
  initialArpu = 4500,
  initialCac = 3800,
  initialMargin = 78,
  currency = 'INR',
}) => {
  const [arpu, setArpu] = useState<number>(initialArpu);
  const [cac, setCac] = useState<number>(initialCac);
  const [grossMargin, setGrossMargin] = useState<number>(initialMargin);
  const [churnRate, setChurnRate] = useState<number>(7);

  // Deterministic Unit Economics calculation
  const economics = FinancialEngine.calculateUnitEconomics({
    arpu_annual: arpu,
    gross_margin_pct: grossMargin,
    annual_churn_rate_pct: churnRate,
    cac: cac,
    sales_cycle_months: 2.5,
  });

  const scenarios = FinancialEngine.generateScenarios(arpu, cac, grossMargin, currency);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white">Deterministic Financial Scenario Engine</h3>
            <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20">
              Zero LLM Arithmetic
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Formulas: LTV = (ARPU &times; Gross Margin) / Churn &bull; Payback = CAC / Monthly Gross Profit
          </p>
        </div>
      </div>

      {/* Input Sliders */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Annual Contract Value (ARPU)</span>
            <span className="font-mono font-bold text-cyan-400">
              {currency === 'INR' ? '₹' : '$'}{arpu.toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min={1000}
            max={20000}
            step={250}
            value={arpu}
            onChange={e => setArpu(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Customer Acquisition Cost (CAC)</span>
            <span className="font-mono font-bold text-cyan-400">
              {currency === 'INR' ? '₹' : '$'}{cac.toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min={500}
            max={10000}
            step={100}
            value={cac}
            onChange={e => setCac(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Target Software Gross Margin</span>
            <span className="font-mono font-bold text-cyan-400">{grossMargin}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={95}
            step={1}
            value={grossMargin}
            onChange={e => setGrossMargin(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Annualized Churn Rate</span>
            <span className="font-mono font-bold text-cyan-400">{churnRate}%</span>
          </div>
          <input
            type="range"
            min={2}
            max={25}
            step={0.5}
            value={churnRate}
            onChange={e => setChurnRate(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>
      </div>

      {/* Calculated KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-3.5">
          <span className="text-[11px] font-semibold text-cyan-400">Customer LTV</span>
          <div className="mt-1 text-xl font-bold font-mono text-white">
            {currency === 'INR' ? '₹' : '$'}{economics.ltv.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400">Lifetime value per customer</span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">LTV : CAC Ratio</span>
          <div className={`mt-1 text-xl font-bold font-mono ${economics.ltv_to_cac >= 3 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {economics.ltv_to_cac}x
          </div>
          <span className="text-[10px] text-slate-400">{economics.ltv_to_cac >= 3 ? 'Healthy SaaS ratio (>3x)' : 'Sub-optimal payback'}</span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">CAC Payback Period</span>
          <div className="mt-1 text-xl font-bold font-mono text-white">
            {economics.payback_period_months} mo
          </div>
          <span className="text-[10px] text-slate-400">Break-even on sales cost</span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">Annual Gross Profit / User</span>
          <div className="mt-1 text-xl font-bold font-mono text-white">
            {currency === 'INR' ? '₹' : '$'}{economics.annual_gross_profit_per_user.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400">Net after software COGS</span>
        </div>
      </div>

      {/* 3-Tier Scenarios Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 text-[11px] font-semibold uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Scenario</th>
              <th className="px-4 py-3">Year 3 ARR Target</th>
              <th className="px-4 py-3">Gross Margin</th>
              <th className="px-4 py-3">CAC Payback</th>
              <th className="px-4 py-3">LTV : CAC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 font-mono">
            <tr className="hover:bg-slate-900/50">
              <td className="px-4 py-3 font-sans font-semibold text-slate-300">Conservative</td>
              <td className="px-4 py-3 text-white">
                {FinancialEngine.formatCurrency(scenarios.scenario_conservative.year_3_revenue, currency)}
              </td>
              <td className="px-4 py-3">{scenarios.scenario_conservative.gross_margin_pct}%</td>
              <td className="px-4 py-3">{scenarios.scenario_conservative.break_even_month} mo</td>
              <td className="px-4 py-3 text-amber-400">{scenarios.scenario_conservative.ltv_to_cac}x</td>
            </tr>
            <tr className="bg-cyan-950/10 hover:bg-cyan-950/20">
              <td className="px-4 py-3 font-sans font-bold text-cyan-300">Base Case</td>
              <td className="px-4 py-3 font-bold text-white">
                {FinancialEngine.formatCurrency(scenarios.scenario_base.year_3_revenue, currency)}
              </td>
              <td className="px-4 py-3 font-bold">{scenarios.scenario_base.gross_margin_pct}%</td>
              <td className="px-4 py-3">{scenarios.scenario_base.break_even_month} mo</td>
              <td className="px-4 py-3 text-emerald-400 font-bold">{scenarios.scenario_base.ltv_to_cac}x</td>
            </tr>
            <tr className="hover:bg-slate-900/50">
              <td className="px-4 py-3 font-sans font-semibold text-slate-300">Aggressive</td>
              <td className="px-4 py-3 text-white">
                {FinancialEngine.formatCurrency(scenarios.scenario_aggressive.year_3_revenue, currency)}
              </td>
              <td className="px-4 py-3">{scenarios.scenario_aggressive.gross_margin_pct}%</td>
              <td className="px-4 py-3">{scenarios.scenario_aggressive.break_even_month} mo</td>
              <td className="px-4 py-3 text-emerald-400">{scenarios.scenario_aggressive.ltv_to_cac}x</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
