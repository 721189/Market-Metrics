import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  ArrowRight, 
  Layers, 
  Target, 
  MapPin, 
  Calendar, 
  Building2, 
  CheckCircle2,
  BookOpen,
  Info
} from 'lucide-react';
import type { ResearchJobRequest } from '../types.js';

interface NewResearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ResearchJobRequest) => void;
  onLoadBenchmark: (benchmarkId: string) => void;
}

const PRESET_BENCHMARKS = [
  {
    id: 'ev-charging-india-2027',
    title: 'Indian EV Charging Software Market (2027 Entry)',
    industry: 'EV Charging Software & CPMS',
    geography: 'India',
    timeHorizon: '2027-2032',
    description: 'B2B fleet depot orchestration, ToD multi-tariffs, PM E-DRIVE subsidy impact, and OCPP 2.0.1 smart-charging.',
    badge: 'Canonical Benchmark (Section 1)',
  },
  {
    id: 'custom-legal-tech',
    title: 'B2B AI Legal Research SaaS in India',
    industry: 'LegalTech & Enterprise AI',
    geography: 'India',
    timeHorizon: '2026-2030',
    description: 'Bar Council regulations, law firm willingness-to-pay, pricing models, and domestic court API access.',
    badge: 'Section 130 Case Study',
  },
  {
    id: 'custom-warehouse-robotics',
    title: 'Autonomous Mobile Robots (AMR) in US Logistics',
    industry: 'Warehouse Automation & AMR Robotics',
    geography: 'United States',
    timeHorizon: '2026-2031',
    description: '3PL warehouse labor economics, RaaS subscription models, and warehouse execution system (WES) integration.',
    badge: 'Industrial Deep-Dive',
  },
];

const COMMON_OBJECTIVES = [
  'Market Sizing (TAM/SAM/SOM)',
  'Historical & Forecast CAGR',
  'Competitor Landscape Matrix',
  'Customer Segments & Willingness-to-Pay',
  'Pricing Analysis & Benchmarks',
  'Regulatory Factors & Subsidies',
  'Deterministic Financial Scenarios',
  'Strategic GTM Recommendations',
];

export const NewResearchModal: React.FC<NewResearchModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onLoadBenchmark,
}) => {
  const [question, setQuestion] = useState('');
  const [industry, setIndustry] = useState('');
  const [geography, setGeography] = useState('India');
  const [timeHorizon, setTimeHorizon] = useState('2027-2032');
  const [targetCompany, setTargetCompany] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>(COMMON_OBJECTIVES);
  const [scopeDepth, setScopeDepth] = useState<'standard' | 'deep' | 'exhaustive'>('deep');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    onSubmit({
      question: question.trim(),
      industry: industry.trim() || 'Software & Technology',
      geography: geography.trim() || 'Global',
      time_horizon: timeHorizon.trim() || '2026-2030',
      objectives: selectedObjectives,
      target_company: targetCompany.trim() || undefined,
      competitors: competitors ? competitors.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      scope_depth: scopeDepth,
    });
    onClose();
  };

  const handleSelectPreset = (preset: typeof PRESET_BENCHMARKS[0]) => {
    if (preset.id === 'ev-charging-india-2027') {
      onLoadBenchmark(preset.id);
      onClose();
      return;
    }

    setQuestion(`Analyze the ${preset.title} for a startup entering the space.`);
    setIndustry(preset.industry);
    setGeography(preset.geography);
    setTimeHorizon(preset.timeHorizon);
  };

  const toggleObjective = (obj: string) => {
    setSelectedObjectives(prev =>
      prev.includes(obj) ? prev.filter(o => o !== obj) : [...prev, obj]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Initialize Market Research Job</h2>
              <p className="text-xs text-slate-400">Strict Model A Planning &bull; Real Source Discovery &bull; Verified Provenance</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Quick Presets / Benchmarks */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-cyan-400" />
              Pre-Configured Golden Benchmarks
            </label>
            <span className="text-[11px] text-cyan-400/80">1-Click Instant Evaluation</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {PRESET_BENCHMARKS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p)}
                className="group flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-cyan-500/50 hover:bg-slate-950 transition-all"
              >
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400 border border-cyan-500/20">
                      {p.badge}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                    {p.title}
                  </h4>
                  <p className="mt-1 text-[11px] line-clamp-2 text-slate-400">{p.description}</p>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-cyan-400">
                  <span>{p.id === 'ev-charging-india-2027' ? 'Load Canonical Benchmark' : 'Fill Parameters'}</span>
                  <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Research Formulation */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-4">
            {/* Main Question */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Primary Research Question <span className="text-cyan-400">*</span>
              </label>
              <textarea
                rows={2}
                required
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. Analyze the Indian EV charging software market for a startup entering in 2027."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* Industry & Geography & Horizon */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />
                  Industry Domain
                </label>
                <input
                  type="text"
                  value={industry}
                  onChange={e => setIndustry(e.target.value)}
                  placeholder="e.g. EV Charging Software / CPMS"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  Target Geography
                </label>
                <input
                  type="text"
                  value={geography}
                  onChange={e => setGeography(e.target.value)}
                  placeholder="e.g. India / APAC / US"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  Time Horizon
                </label>
                <input
                  type="text"
                  value={timeHorizon}
                  onChange={e => setTimeHorizon(e.target.value)}
                  placeholder="e.g. 2027-2032"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Target Competitors & Entities */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  Known Competitors (Optional)
                </label>
                <input
                  type="text"
                  value={competitors}
                  onChange={e => setCompetitors(e.target.value)}
                  placeholder="e.g. Kazam, Pulse Energy, Statiq, ChargeZone"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                  <Target className="h-3.5 w-3.5 text-slate-400" />
                  Hypothetical Entrant / Wedge (Optional)
                </label>
                <input
                  type="text"
                  value={targetCompany}
                  onChange={e => setTargetCompany(e.target.value)}
                  placeholder="e.g. Hardware-agnostic B2B depot SaaS"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Scope Objectives Checkbox Grid */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Required Analysis Dimensions (Pydantic Schema Targets)
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {COMMON_OBJECTIVES.map(obj => {
                  const isSelected = selectedObjectives.includes(obj);
                  return (
                    <button
                      type="button"
                      key={obj}
                      onClick={() => toggleObjective(obj)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition-all ${
                        isSelected
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <CheckCircle2 className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-600'}`} />
                      <span className="truncate">{obj}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Verification Protocol Notice */}
          <div className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-400">
            <Info className="h-4 w-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            <p>
              <strong className="text-slate-200">V2 Architectural Enforcement:</strong> Every statement produced will be grounded in discovered external sources. Numeric assertions will be calculated deterministically with Python/TS formulas, and claims audited for provenance before report generation.
            </p>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!question.trim()}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all"
            >
              <Sparkles className="h-4 w-4" />
              Launch Research Pipeline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
