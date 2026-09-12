import React, { useState } from 'react';
import { 
  Sparkles, 
  Search, 
  ArrowRight, 
  Layers, 
  Globe, 
  Calendar, 
  Building2, 
  Target, 
  CheckCircle2, 
  ShieldCheck, 
  Calculator, 
  Database,
  Cpu,
  TrendingUp,
  FileText,
  Clock,
  Zap,
  Activity
} from 'lucide-react';
import type { ResearchJobRequest, ResearchJob } from '../types.js';

interface HomeWorkspaceProps {
  onLaunchResearch: (data: ResearchJobRequest) => void;
  recentJobs: ResearchJob[];
  onOpenJob: (job: ResearchJob) => void;
}

const INDUSTRY_STARTERS = [
  {
    title: 'B2B AI Agent Workflow Automation',
    industry: 'Enterprise AI & Agentic Workflow SaaS',
    geography: 'North America',
    horizon: '2026-2030',
    description: 'Enterprise willingness-to-pay, security compliance, usage-based pricing models, and incumbent ERP bundling risk.',
    tag: 'AI & Enterprise SaaS',
  },
  {
    title: 'Autonomous Mobile Robots (AMR) in Logistics',
    industry: 'Warehouse Automation & AMR Robotics',
    geography: 'United States & APAC',
    horizon: '2026-2031',
    description: '3PL warehouse labor economics, Robotics-as-a-Service (RaaS) payback period, and WES/WMS integrations.',
    tag: 'Robotics & Industrial',
  },
  {
    title: 'Cross-Border B2B Payment Infrastructure',
    industry: 'FinTech & Cross-Border Rails',
    geography: 'Europe & Southeast Asia',
    horizon: '2026-2030',
    description: 'ISO 20022 compliance, interchange fee compression, FX spread monetization, and real-time settlement APIs.',
    tag: 'FinTech & Payments',
  },
  {
    title: 'Grid-Scale Battery Energy Storage (BESS) Software',
    industry: 'CleanTech & Renewable Energy Storage',
    geography: 'Global',
    horizon: '2026-2032',
    description: 'Wholesale power arbitrage, ancillary service revenue, degradation modeling, and grid interconnection queues.',
    tag: 'Energy & Climate',
  },
  {
    title: 'AI Pathology & Clinical Decision Workflow',
    industry: 'HealthTech & Diagnostic AI',
    geography: 'North America',
    horizon: '2026-2030',
    description: 'FDA 510(k) clearance timelines, CPT reimbursement codes, hospital procurement cycles, and PACS interoperability.',
    tag: 'Healthcare & Biotech',
  },
  {
    title: 'Electric Fleet Depot Smart-Charging Software',
    industry: 'EV Charging Software & CPMS',
    geography: 'India',
    horizon: '2027-2032',
    description: 'Time-of-Day multi-tariffs, PM E-DRIVE subsidies, OCPP 2.0.1 compliance, and commercial fleet economics.',
    tag: 'Mobility & Infrastructure',
  },
];

const ANALYSIS_DIMENSIONS = [
  'Market Sizing (TAM/SAM/SOM)',
  'Verified Historical & Forecast CAGR',
  'Competitor Landscape Matrix',
  'Customer Segments & Buying Criteria',
  'Pricing Analysis & Benchmarks',
  'Regulatory & Policy Mandates',
  'Deterministic Financial Scenarios',
  'Strategic GTM Recommendations',
];

export const HomeWorkspace: React.FC<HomeWorkspaceProps> = ({
  onLaunchResearch,
  recentJobs,
  onOpenJob,
}) => {
  const [question, setQuestion] = useState('');
  const [industry, setIndustry] = useState('');
  const [geography, setGeography] = useState('Global');
  const [timeHorizon, setTimeHorizon] = useState('2026-2030');
  const [competitors, setCompetitors] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>(ANALYSIS_DIMENSIONS);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    onLaunchResearch({
      question: question.trim(),
      industry: industry.trim() || 'Software & Technology',
      geography: geography.trim() || 'Global',
      time_horizon: timeHorizon.trim() || '2026-2030',
      objectives: selectedObjectives,
      target_company: targetCompany.trim() || undefined,
      competitors: competitors ? competitors.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    });
  };

  const handleSelectStarter = (starter: typeof INDUSTRY_STARTERS[0]) => {
    setQuestion(`Analyze the ${starter.title} market for a startup or strategic entrant.`);
    setIndustry(starter.industry);
    setGeography(starter.geography);
    setTimeHorizon(starter.horizon);
  };

  const toggleObjective = (obj: string) => {
    setSelectedObjectives(prev =>
      prev.includes(obj) ? prev.filter(o => o !== obj) : [...prev, obj]
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-10">
      {/* Hero Section */}
      <div className="text-center max-w-3xl mx-auto space-y-4 pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
          <Sparkles className="h-3.5 w-3.5" />
          Universal Market Intelligence Engine &bull; V2 Architecture
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
          Institutional-Grade Market Research for <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Any Industry</span>
        </h1>
        <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
          Formulate comprehensive strategic intelligence, compute deterministic TAM & CAGR forecasts, and audit verified claim provenance across primary sources.
        </p>
      </div>

      {/* Main Research Command Center Box */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6 sm:p-8 shadow-2xl space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Main Question Input */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span>What market, domain, or strategic question do you want to research?</span>
              <span className="text-cyan-400 text-[11px] font-normal">Supports any geography, product, or sector</span>
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
              <input
                type="text"
                required
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. Analyze the B2B AI Agent software market in North America for an entrant in 2026..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900/90 pl-12 pr-4 py-3.5 text-sm sm:text-base text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all shadow-inner"
              />
            </div>
          </div>

          {/* Quick Context Parameters */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Layers className="h-3 w-3 text-slate-400" /> Industry / Subsector
              </label>
              <input
                type="text"
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                placeholder="e.g. Enterprise AI SaaS, CleanTech, FinTech"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Globe className="h-3 w-3 text-slate-400" /> Target Geography
              </label>
              <input
                type="text"
                value={geography}
                onChange={e => setGeography(e.target.value)}
                placeholder="e.g. Global, North America, Europe, India"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Calendar className="h-3 w-3 text-slate-400" /> Time Horizon
              </label>
              <input
                type="text"
                value={timeHorizon}
                onChange={e => setTimeHorizon(e.target.value)}
                placeholder="e.g. 2026-2030, 2027-2032"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Collapsible Advanced Parameters */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
            >
              <span>{isAdvancedOpen ? '− Hide Advanced Parameters' : '+ Configure Competitors, Wedge & Analysis Dimensions'}</span>
            </button>

            {isAdvancedOpen && (
              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4 animate-in fade-in">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1 flex items-center gap-1">
                      <Building2 className="h-3 w-3 text-slate-400" />
                      Known Competitors / Peers (Optional)
                    </label>
                    <input
                      type="text"
                      value={competitors}
                      onChange={e => setCompetitors(e.target.value)}
                      placeholder="e.g. Salesforce, UiPath, Retool, CrewAI"
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1 flex items-center gap-1">
                      <Target className="h-3 w-3 text-slate-400" />
                      Entrant Wedge / Business Model (Optional)
                    </label>
                    <input
                      type="text"
                      value={targetCompany}
                      onChange={e => setTargetCompany(e.target.value)}
                      placeholder="e.g. Developer-first API with usage-based billing"
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Required Analysis Dimensions (Pydantic Targets)
                  </label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ANALYSIS_DIMENSIONS.map(obj => {
                      const isSelected = selectedObjectives.includes(obj);
                      return (
                        <button
                          type="button"
                          key={obj}
                          onClick={() => toggleObjective(obj)}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-all ${
                            isSelected
                              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <CheckCircle2 className={`h-3 w-3 flex-shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-600'}`} />
                          <span className="truncate">{obj}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Submit Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Grounded via Search &bull; Exact Provenance Offsets &bull; Deterministic Math</span>
            </div>

            <button
              type="submit"
              disabled={!question.trim()}
              className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              Launch Research Pipeline
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Instant Industry Starters (Spanning Multiple Domains) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Zap className="h-4 w-4 text-cyan-400" />
            Explore Multi-Sector Research Starters
          </h3>
          <span className="text-[11px] text-slate-400">1-Click Query Population</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRY_STARTERS.map((starter, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelectStarter(starter)}
              className="group flex flex-col justify-between rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 text-left hover:border-cyan-500/50 hover:bg-slate-900 transition-all"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 border border-cyan-500/20">
                    {starter.tag}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{starter.geography}</span>
                </div>
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {starter.title}
                </h4>
                <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                  {starter.description}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs font-medium text-cyan-400 pt-2 border-t border-slate-800/60">
                <span>Populate Form</span>
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Previous Research History Library */}
      {recentJobs.length > 0 && (
        <div className="space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              Workspace Research Library ({recentJobs.length})
            </h3>
          </div>

          <div className="space-y-2">
            {recentJobs.map(job => (
              <div
                key={job.id}
                onClick={() => onOpenJob(job)}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-700 hover:bg-slate-900 cursor-pointer transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      job.status === 'COMPLETED'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    }`}>
                      {job.status}
                    </span>
                    <span className="text-xs font-bold text-white">{job.question}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span><strong>Domain:</strong> {job.industry}</span>
                    <span>&bull;</span>
                    <span><strong>Geography:</strong> {job.geography}</span>
                    <span>&bull;</span>
                    <span><strong>Created:</strong> {new Date(job.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {job.stats.evidence_score > 0 && (
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">Score</span>
                      <span className="font-mono font-bold text-cyan-400 text-sm">
                        {job.stats.evidence_score}/100
                      </span>
                    </div>
                  )}
                  <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                    View Report &rarr;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Architectural Guarantees Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs">
        <div className="flex items-start gap-3">
          <Cpu className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div>
            <h5 className="font-bold text-white">Model A &rarr; F Pipeline</h5>
            <p className="text-[11px] text-slate-400 mt-0.5">Sequential stages: Planning, Discovery, Extraction, Verification & Synthesis.</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Calculator className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <h5 className="font-bold text-white">Deterministic Math</h5>
            <p className="text-[11px] text-slate-400 mt-0.5">CAGR, TAM/SAM/SOM, and LTV:CAC computed with exact formulas.</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <h5 className="font-bold text-white">Provenanced Claims</h5>
            <p className="text-[11px] text-slate-400 mt-0.5">Every statement links to source quotes and document character offsets.</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h5 className="font-bold text-white">Tier A-D Validation</h5>
            <p className="text-[11px] text-slate-400 mt-0.5">Sources classified by credibility: Government, Research, and Trade Media.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
