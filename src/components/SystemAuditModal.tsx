import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Play, 
  RefreshCw, 
  Lock, 
  Server, 
  Cpu, 
  X, 
  Database,
  Download,
  AlertTriangle,
  Layers,
  DollarSign
} from 'lucide-react';

interface SystemAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemAuditModal: React.FC<SystemAuditModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'suites' | 'telemetry' | 'secrets' | 'backups'>('suites');
  const [loadingSuite, setLoadingSuite] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [metrics, setMetrics] = useState<any>(null);
  const [secrets, setSecrets] = useState<any>(null);
  const [readyInfo, setReadyInfo] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      loadSystemStats();
    }
  }, [isOpen]);

  const loadSystemStats = async () => {
    try {
      const [readyRes, metricsRes, secretsRes] = await Promise.all([
        fetch('/ready').then(r => r.json()),
        fetch('/api/v1/metrics').then(r => r.json()),
        fetch('/api/v1/system/secrets').then(r => r.json()),
      ]);
      setReadyInfo(readyRes);
      setMetrics(metricsRes);
      setSecrets(secretsRes);
    } catch (e) {
      console.warn('Could not load system stats:', e);
    }
  };

  const runSuite = async (endpoint: string, suiteKey: string) => {
    setLoadingSuite(suiteKey);
    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [suiteKey]: data }));
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [suiteKey]: {
          suite_name: suiteKey,
          all_passed: false,
          total: 1,
          passed: 0,
          failed: 1,
          results: [{ test_name: 'Execution Error', status: 'FAIL', details: err.message }],
        },
      }));
    } finally {
      setLoadingSuite(null);
    }
  };

  const runAllSuites = async () => {
    await runSuite('/api/v1/tests/financial', 'financial');
    await runSuite('/api/v1/tests/security', 'security');
    await runSuite('/api/v1/tests/e2e', 'e2e');
    await runSuite('/api/v1/tests/load', 'load');
  };

  const downloadBackup = () => {
    window.open('/api/v1/admin/backup', '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                System Health & Institutional Test Suites
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                  Production V2
                </span>
              </h2>
              <p className="text-xs text-slate-400">Deterministic verification, security audit, BullMQ status & telemetry</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-6 text-xs">
          <button
            onClick={() => setActiveTab('suites')}
            className={`border-b-2 py-3 px-4 font-medium transition-all ${
              activeTab === 'suites'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Test Suites (4)
          </button>
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`border-b-2 py-3 px-4 font-medium transition-all ${
              activeTab === 'telemetry'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Telemetry & Queue
          </button>
          <button
            onClick={() => setActiveTab('secrets')}
            className={`border-b-2 py-3 px-4 font-medium transition-all ${
              activeTab === 'secrets'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Secrets & Provider Guard
          </button>
          <button
            onClick={() => setActiveTab('backups')}
            className={`border-b-2 py-3 px-4 font-medium transition-all ${
              activeTab === 'backups'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Postgres DB & Backups
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
          {activeTab === 'suites' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Execute deterministic test suites covering closed-form financial math, input security sanitization, full E2E pipeline state flow, and concurrency load.
                </p>
                <button
                  onClick={runAllSuites}
                  disabled={loadingSuite !== null}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Run All Tests
                </button>
              </div>

              {/* Suite Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Financial Math */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-slate-200 text-xs">
                      <Cpu className="h-4 w-4 text-cyan-400" />
                      1. Financial Math Suite
                    </div>
                    <button
                      onClick={() => runSuite('/api/v1/tests/financial', 'financial')}
                      disabled={loadingSuite === 'financial'}
                      className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-cyan-400 hover:bg-slate-700 transition-colors"
                    >
                      {loadingSuite === 'financial' ? 'Running...' : 'Run Test'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">Tests CAGR compound formula, TAM/SAM/SOM sizing bounds, LTV:CAC arithmetic, and sensitivity matrices.</p>
                  {testResults.financial && (
                    <div className={`p-2.5 rounded-lg text-[11px] border ${testResults.financial.all_passed ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-rose-950/40 border-rose-500/30 text-rose-300'}`}>
                      <div className="flex items-center justify-between font-semibold">
                        <span>{testResults.financial.passed} / {testResults.financial.total} Tests Passed</span>
                        <span>{testResults.financial.duration_ms}ms</span>
                      </div>
                      <div className="mt-2 space-y-1 text-[10px] opacity-90">
                        {testResults.financial.results.map((r: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between">
                            <span>✓ {r.test_name}</span>
                            <span className="font-mono">{r.actual || 'PASS'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Security Suite */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-slate-200 text-xs">
                      <Lock className="h-4 w-4 text-emerald-400" />
                      2. Security & Sanitization Suite
                    </div>
                    <button
                      onClick={() => runSuite('/api/v1/tests/security', 'security')}
                      disabled={loadingSuite === 'security'}
                      className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-slate-700 transition-colors"
                    >
                      {loadingSuite === 'security' ? 'Running...' : 'Run Test'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">Tests SQL injection DDL sanitization, XSS HTML strip filters, payload memory caps, and secrets redaction.</p>
                  {testResults.security && (
                    <div className={`p-2.5 rounded-lg text-[11px] border ${testResults.security.all_passed ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-rose-950/40 border-rose-500/30 text-rose-300'}`}>
                      <div className="flex items-center justify-between font-semibold">
                        <span>{testResults.security.passed} / {testResults.security.total} Tests Passed</span>
                        <span>{testResults.security.duration_ms}ms</span>
                      </div>
                      <div className="mt-2 space-y-1 text-[10px] opacity-90">
                        {testResults.security.results.map((r: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between">
                            <span>✓ {r.test_name}</span>
                            <span className="font-mono">{r.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. E2E Suite */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-slate-200 text-xs">
                      <Activity className="h-4 w-4 text-blue-400" />
                      3. E2E Pipeline Integration
                    </div>
                    <button
                      onClick={() => runSuite('/api/v1/tests/e2e', 'e2e')}
                      disabled={loadingSuite === 'e2e'}
                      className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-blue-400 hover:bg-slate-700 transition-colors"
                    >
                      {loadingSuite === 'e2e' ? 'Running...' : 'Run Test'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">Tests real document fetcher character offset alignment, database CRUD cycles, and citation graph resolution.</p>
                  {testResults.e2e && (
                    <div className={`p-2.5 rounded-lg text-[11px] border ${testResults.e2e.all_passed ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-rose-950/40 border-rose-500/30 text-rose-300'}`}>
                      <div className="flex items-center justify-between font-semibold">
                        <span>{testResults.e2e.passed} / {testResults.e2e.total} Tests Passed</span>
                        <span>{testResults.e2e.duration_ms}ms</span>
                      </div>
                      <div className="mt-2 space-y-1 text-[10px] opacity-90">
                        {testResults.e2e.results.map((r: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between">
                            <span>✓ {r.test_name}</span>
                            <span className="font-mono">{r.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Load Suite */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-slate-200 text-xs">
                      <Layers className="h-4 w-4 text-purple-400" />
                      4. Concurrency & Load Suite
                    </div>
                    <button
                      onClick={() => runSuite('/api/v1/tests/load', 'load')}
                      disabled={loadingSuite === 'load'}
                      className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-purple-400 hover:bg-slate-700 transition-colors"
                    >
                      {loadingSuite === 'load' ? 'Running...' : 'Run Test'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">Dispatches 10 parallel asynchronous state machine operations to verify queue concurrency and memory stability.</p>
                  {testResults.load && (
                    <div className={`p-2.5 rounded-lg text-[11px] border ${testResults.load.all_passed ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-rose-950/40 border-rose-500/30 text-rose-300'}`}>
                      <div className="flex items-center justify-between font-semibold">
                        <span>{testResults.load.passed} / {testResults.load.total} Tests Passed</span>
                        <span>{testResults.load.duration_ms}ms</span>
                      </div>
                      <div className="mt-2 space-y-1 text-[10px] opacity-90">
                        {testResults.load.results.map((r: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between">
                            <span>✓ {r.test_name}</span>
                            <span className="font-mono">{r.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'telemetry' && metrics && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-slate-400 text-[11px]">HTTP Requests</div>
                  <div className="text-lg font-bold text-white mt-1">{metrics.telemetry.requests_total}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-slate-400 text-[11px]">Latency (p95)</div>
                  <div className="text-lg font-bold text-cyan-400 mt-1">{metrics.telemetry.latency_p95_ms}ms</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-slate-400 text-[11px]">Active Workers</div>
                  <div className="text-lg font-bold text-purple-400 mt-1">{metrics.queue.active} / {metrics.queue.concurrency_limit}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-slate-400 text-[11px]">Heap Usage</div>
                  <div className="text-lg font-bold text-emerald-400 mt-1">{metrics.telemetry.memory_heap_mb} MB</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <h4 className="font-semibold text-slate-200">BullMQ Queue Telemetry</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">Waiting: <span className="font-mono text-cyan-300">{metrics.queue.waiting}</span></div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">Completed: <span className="font-mono text-emerald-300">{metrics.queue.completed}</span></div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">Failed (DLQ): <span className="font-mono text-rose-300">{metrics.queue.dlq || metrics.queue.failed}</span></div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">Avg Duration: <span className="font-mono text-slate-300">{metrics.queue.avg_process_time_ms}ms</span></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'secrets' && secrets && metrics && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-emerald-400" />
                  Masked Production Secrets Status
                </h4>
                <div className="space-y-2">
                  {Object.entries(secrets).map(([key, val]: [string, any]) => (
                    <div key={key} className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                      <span className="font-mono text-slate-300">{key}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${val.configured ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}`}>
                        {val.configured ? `CONFIGURED (${val.preview})` : 'UNSET (FALLBACK ACTIVE)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-cyan-400" />
                  Provider Token & Cost Guard Limits
                </h4>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Tokens Tracked</div>
                    <div className="text-sm font-bold text-white mt-1 font-mono">{metrics.costs.total_tokens_tracked.toLocaleString()}</div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Estimated Cost</div>
                    <div className="text-sm font-bold text-emerald-400 mt-1 font-mono">${metrics.costs.total_cost_usd}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backups' && readyInfo && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                  <Database className="h-4 w-4 text-cyan-400" />
                  Postgres Persistence & Schema Migrations
                </h4>
                <div className="p-3 rounded bg-slate-900 border border-slate-800 space-y-1">
                  <div>Engine: <span className="font-semibold text-cyan-400">{readyInfo.database?.engine}</span></div>
                  <div>Applied Migrations: <span className="font-mono text-slate-300">{readyInfo.database?.migrations_applied}</span></div>
                  <div>Persisted Records: <span className="font-mono text-slate-300">{readyInfo.persisted_jobs_count} jobs</span></div>
                </div>
                <button
                  onClick={downloadBackup}
                  className="flex items-center gap-2 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Export Database Snapshot (JSON)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
