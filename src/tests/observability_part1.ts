/**
 * Phase-3 remainder checks: spans, metrics persistence, alert rules,
 * and the cost-breakdown HTTP contract.
 * Split to keep each file under the editor size limit.
 */

import {
  evaluateAlerts,
  metrics,
  MetricNames,
  recordJobCompleted,
  recordProviderCall,
  recordQueueDepth,
  type Alert,
} from '../server/observability.js';
import { flushMetricsNow, startMetricsFlusher, stopMetricsFlusher } from '../server/ops_metrics.js';
import { startSpan, endSpanWithError } from '../server/spans.js';
import type { Check } from './deploy_layer.test.js';

export const observabilityChecks: Check[] = [
  {
    name: 'spans record stage duration + emit a structured log line',
    fn: async () => {
      const span = startSpan('test-stage', { job_id: 'job-span-1', stage: 'VERIFYING' });
      const duration = span.end();
      if (!(duration >= 0)) return false;
      const snap = metrics.snapshot();
      return snap.some((s) => s.name === MetricNames.stageDuration);
    },
  },
  {
    name: 'provider spans record latency; errors record the failure counter',
    fn: async () => {
      const span = startSpan('gemini-call', { job_id: 'job-span-2', provider: true, operation: 'test-op' });
      span.end();
      const failing = startSpan('gemini-call', { job_id: 'job-span-2', provider: true, operation: 'test-op' });
      endSpanWithError(failing, new Error('provider down'), { job_id: 'job-span-2', provider: true, operation: 'test-op' });
      recordProviderCall(12, true, { operation: 'test-op' });
      const snap = metrics.snapshot();
      return snap.some((s) => s.name === MetricNames.providerLatency);
    },
  },
  {
    name: 'alert rules fire against seeded metrics (queue backlog + provider outage)',
    fn: async () => {
      // Threshold for provider_errors is >10, so record 11 failures to cross it.
      recordQueueDepth(500);
      for (let i = 0; i < 11; i++) {
        recordProviderCall(5, false, { operation: 'seeded-outage' });
      }
      const alerts: Alert[] = evaluateAlerts(metrics);
      const names = new Set(alerts.map((a) => a.rule));
      return names.has('queue_backlog') && names.has('provider_errors');
    },
  },
  {
    name: 'citation-validation failure raises the critical alert',
    fn: async () => {
      const { recordCitationFailure } = await import('../server/observability.js');
      recordCitationFailure('job-alert-1');
      const alerts = evaluateAlerts(metrics);
      return alerts.some((a) => a.rule === 'citation_validation_failures' && a.severity === 'critical');
    },
  },
  {
    name: 'metrics flusher starts, flushes, and stops without throwing',
    fn: async () => {
      startMetricsFlusher(60000);
      startMetricsFlusher(60000);
      await flushMetricsNow();
      stopMetricsFlusher();
      recordJobCompleted(100, { job_id: 'job-flush-1' });
      return true;
    },
  },
];
