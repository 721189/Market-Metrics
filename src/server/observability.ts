import { logEnvelope } from './rate_limits.js';

/**
 * Observability: Metrics + Alerts (production hardening, item 21)
 * ---------------------------------------------------------------------------
 * The structured log envelope already answers "what happened on this request?".
 * This module answers the operational questions: how many jobs are running, how
 * deep is the queue, how long does each stage take, how often do leases get
 * recovered, how often does citation validation reject a report, and what does a
 * job cost.
 *
 * Design constraints (deliberate, not incidental):
 *
 *   1. Dependency-free and deterministic. Metric math must be auditable and
 *      reproducible; it never calls a model.
 *   2. Bounded memory. Label cardinality is capped and counters are keyed by a
 *      normalized label signature, so a hostile or buggy caller cannot grow the
 *      registry without limit (a real availability concern in a public service).
 *   3. Percentile-correct histograms. Fixed buckets give p50/p95/p99 without
 *      retaining every observation.
 *   4. Alerts are declarative rules over the registry, evaluated on demand, so
 *      the same rules run in tests and in production.
 *
 * Metric names come from the hardening spec and are exported as a frozen
 * constant, so a typo becomes a compile error instead of a silently empty graph.
 */

/** Metric names required by the production checklist. */
export const MetricNames = {
  jobsStarted: 'jobs_started',
  jobsCompleted: 'jobs_completed',
  jobsFailed: 'jobs_failed',
  jobDuration: 'job_duration_ms',
  stageDuration: 'stage_duration_ms',
  providerLatency: 'provider_latency_ms',
  providerErrors: 'provider_errors',
  queueDepth: 'queue_depth',
  leaseRecoveries: 'lease_recoveries',
  citationFailures: 'citation_failures',
  verificationFailures: 'verification_failures',
  costPerJob: 'cost_per_job_usd',
} as const;

export type MetricName = (typeof MetricNames)[keyof typeof MetricNames];

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export interface MetricSeries {
  name: string;
  kind: MetricKind;
  labels: Record<string, string>;
  count: number;
  sum: number;
  min: number;
  max: number;
  /** Last observed value (counters/gauges use this as the current value). */
  value: number;
}

export interface HistogramSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Latency buckets in milliseconds. Chosen to straddle every budget in the
 * system: a Firestore transaction (single ms) up to a model call (tens of s).
 */
const HISTOGRAM_BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
];

/**
 * Maximum distinct label signatures per metric. Beyond this, observations are
 * folded into a shared `__overflow__` series rather than dropped, so totals stay
 * truthful and memory stays bounded.
 */
const MAX_SERIES_PER_METRIC = 64;

/** Bound on label values so a caller cannot inject unbounded strings. */
const MAX_LABEL_VALUE_LENGTH = 64;

export type Labels = Record<string, string | number | boolean | undefined | null>;

/** Normalize a label set into a stable, bounded signature. */
function normalizeLabels(labels: Labels | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!labels) return out;
  for (const key of Object.keys(labels).sort()) {
    const raw = labels[key];
    if (raw === undefined || raw === null) continue;
    let value = String(raw);
    if (value.length > MAX_LABEL_VALUE_LENGTH) {
      value = `${value.slice(0, MAX_LABEL_VALUE_LENGTH - 1)}~`;
    }
    out[key] = value;
  }
  return out;
}

function signatureOf(labels: Record<string, string>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

interface InternalSeries extends MetricSeries {
  /** Histogram bucket upper bounds and their counts. */
  bucketBounds: number[];
  bucketCounts: number[];
}

export class MetricsRegistry {
  private series = new Map<string, InternalSeries>();

  private key(name: string, signature: string): string {
    return signature ? `${name}{${signature}}` : name;
  }

  private countSeriesForMetric(name: string): number {
    let n = 0;
    for (const s of this.series.values()) {
      if (s.name === name) n++;
    }
    return n;
  }

  private seriesFor(name: string, kind: MetricKind, labels: Record<string, string>): InternalSeries {
    const fullKey = this.key(name, signatureOf(labels));
    const existing = this.series.get(fullKey);
    if (existing) return existing;

    // Cardinality guard: beyond the cap, fold into one shared overflow series so
    // totals stay truthful while memory stays bounded.
    const siblings = this.countSeriesForMetric(name);
    const effectiveLabels = siblings >= MAX_SERIES_PER_METRIC ? { __overflow__: 'true' } : labels;
    const effectiveKey = this.key(name, signatureOf(effectiveLabels));

    const overflowExisting = this.series.get(effectiveKey);
    if (overflowExisting) return overflowExisting;

    const created: InternalSeries = {
      name,
      kind,
      labels: effectiveLabels,
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      value: 0,
      bucketBounds: kind === 'histogram' ? [...HISTOGRAM_BUCKETS_MS] : [],
      bucketCounts: kind === 'histogram' ? new Array(HISTOGRAM_BUCKETS_MS.length + 1).fill(0) : [],
    };
    this.series.set(effectiveKey, created);
    return created;
  }

  /** Record one or more occurrences of a counter. */
  increment(name: MetricName | string, labels?: Labels, by = 1): void {
    const series = this.seriesFor(name, 'counter', normalizeLabels(labels));
    series.count += by;
    series.sum += by;
    series.value = series.count;
    if (series.value < series.min) series.min = series.value;
    if (series.value > series.max) series.max = series.value;
  }

  /** Set a gauge to its current value (queue depth, in-flight work, ...). */
  setGauge(name: MetricName | string, value: number, labels?: Labels): void {
    const series = this.seriesFor(name, 'gauge', normalizeLabels(labels));
    series.value = value;
    series.sum += value;
    series.count += 1;
    if (value < series.min) series.min = value;
    if (value > series.max) series.max = value;
  }

  /** Record one observation into a histogram (durations, latencies, costs). */
  observe(name: MetricName | string, value: number, labels?: Labels): void {
    const series = this.seriesFor(name, 'histogram', normalizeLabels(labels));
    const v = Number.isFinite(value) ? value : 0;
    series.count += 1;
    series.sum += v;
    series.value = v;
    if (v < series.min) series.min = v;
    if (v > series.max) series.max = v;

    // Bucket placement: first bound >= v, else the +Inf overflow bucket.
    let placed = false;
    for (let i = 0; i < series.bucketBounds.length; i++) {
      if (v <= series.bucketBounds[i]) {
        series.bucketCounts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) series.bucketCounts[series.bucketCounts.length - 1] += 1;
  }

  /** Current counter value for a series (0 when unseen). */
  getCounter(name: MetricName | string, labels?: Labels): number {
    const series = this.series.get(this.key(name, signatureOf(normalizeLabels(labels))));
    return series ? series.count : 0;
  }

  /** Current gauge value for a series (0 when unseen). */
  getGauge(name: MetricName | string, labels?: Labels): number {
    const series = this.series.get(this.key(name, signatureOf(normalizeLabels(labels))));
    return series ? series.value : 0;
  }

  /** Percentile summary for a histogram series, computed from buckets. */
  histogram(name: MetricName | string, labels?: Labels): HistogramSummary {
    const series = this.series.get(this.key(name, signatureOf(normalizeLabels(labels))));
    if (!series || series.kind !== 'histogram' || series.count === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    }
    const quantile = (q: number): number => {
      const target = Math.ceil(q * series.count);
      let cumulative = 0;
      for (let i = 0; i < series.bucketCounts.length; i++) {
        cumulative += series.bucketCounts[i];
        if (cumulative >= target) {
          // Report the bucket's upper bound; the overflow bucket reports max.
          return i < series.bucketBounds.length ? series.bucketBounds[i] : series.max;
        }
      }
      return series.max;
    };
    return {
      count: series.count,
      sum: series.sum,
      min: series.min === Number.POSITIVE_INFINITY ? 0 : series.min,
      max: series.max === Number.NEGATIVE_INFINITY ? 0 : series.max,
      mean: series.sum / series.count,
      p50: quantile(0.5),
      p95: quantile(0.95),
      p99: quantile(0.99),
    };
  }

  /** All series, sorted by name then label signature. Deterministic output. */
  snapshot(): MetricSeries[] {
    const all = [...this.series.values()].map((s) => ({
      name: s.name,
      kind: s.kind,
      labels: { ...s.labels },
      count: s.count,
      sum: s.sum,
      min: s.min === Number.POSITIVE_INFINITY ? 0 : s.min,
      max: s.max === Number.NEGATIVE_INFINITY ? 0 : s.max,
      value: s.value,
    }));
    all.sort((a, b) => (a.name === b.name
      ? signatureOf(a.labels).localeCompare(signatureOf(b.labels))
      : a.name.localeCompare(b.name)));
    return all;
  }

  /** Number of distinct series currently retained (for the cardinality cap). */
  seriesCount(): number {
    return this.series.size;
  }

  /** Drop all series. Used by tests and by a full reset after a config reload. */
  reset(): void {
    this.series.clear();
  }
}

// ---------------------------------------------------------------------------
// ALERTS
// ---------------------------------------------------------------------------

export type AlertComparator = 'gt' | 'gte' | 'lt' | 'lte';

export type AlertSeverity = 'warning' | 'critical';

export interface AlertRule {
  /** Stable rule id, used as the alert's identity in logs. */
  name: string;
  metric: MetricName | string;
  /** Optional label selector; when present, only matching series are evaluated. */
  matchLabels?: Labels;
  comparator: AlertComparator;
  threshold: number;
  severity: AlertSeverity;
  /** Human-readable explanation of what firing means. */
  message: string;
}

export interface Alert {
  rule: string;
  severity: AlertSeverity;
  metric: string;
  observed: number;
  threshold: number;
  comparator: AlertComparator;
  message: string;
}

/**
 * Default operational rules. These encode the failure modes that matter for an
 * evidence engine: a dead worker pool, a queue backing up, a provider outage, a
 * report pipeline that is rejecting its own citations, and runaway cost.
 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: 'queue_backlog',
    metric: MetricNames.queueDepth,
    comparator: 'gt',
    threshold: 200,
    severity: 'warning',
    message: 'Queue depth exceeds 200; worker pool is not keeping up.',
  },
  {
    name: 'queue_backlog_critical',
    metric: MetricNames.queueDepth,
    comparator: 'gt',
    threshold: 2000,
    severity: 'critical',
    message: 'Queue depth exceeds 2000; enqueueing should be shed or workers scaled.',
  },
  {
    name: 'job_failure_ratio',
    metric: MetricNames.jobsFailed,
    comparator: 'gt',
    threshold: 50,
    severity: 'warning',
    message: 'More than 50 jobs have failed; investigate the failing stage.',
  },
  {
    name: 'lease_recovery_storm',
    metric: MetricNames.leaseRecoveries,
    comparator: 'gt',
    threshold: 25,
    severity: 'warning',
    message: 'Frequent lease recoveries imply worker crashes or lease starvation.',
  },
  {
    name: 'provider_errors',
    metric: MetricNames.providerErrors,
    comparator: 'gt',
    threshold: 10,
    severity: 'critical',
    message: 'Model provider is returning errors; synthesis/extraction reliability degraded.',
  },
  {
    name: 'citation_validation_failures',
    metric: MetricNames.citationFailures,
    comparator: 'gt',
    threshold: 0,
    severity: 'critical',
    message: 'A report failed mandatory citation-graph validation. This must never be silent.',
  },
  {
    name: 'job_cost_outlier',
    metric: MetricNames.costPerJob,
    comparator: 'gt',
    threshold: 5,
    severity: 'warning',
    message: 'A single job cost more than $5; check for retry storms or runaway fetches.',
  },
];

function compare(observed: number, comparator: AlertComparator, threshold: number): boolean {
  switch (comparator) {
    case 'gt': return observed > threshold;
    case 'gte': return observed >= threshold;
    case 'lt': return observed < threshold;
    case 'lte': return observed <= threshold;
    default: return false;
  }
}

function labelsMatch(series: Record<string, string>, selector: Labels | undefined): boolean {
  if (!selector) return true;
  const normalized = normalizeLabels(selector);
  for (const key of Object.keys(normalized)) {
    if (series[key] !== normalized[key]) return false;
  }
  return true;
}

/**
 * Evaluate rules against a registry. Counter and gauge series contribute their
 * current value; histogram series contribute their max observation (an outlier
 * in a latency or cost distribution is what an operator needs to see).
 */
export function evaluateAlerts(
  registry: MetricsRegistry,
  rules: AlertRule[] = DEFAULT_ALERT_RULES,
): Alert[] {
  const alerts: Alert[] = [];
  const snapshot = registry.snapshot();

  for (const rule of rules) {
    let observed: number | null = null;
    for (const series of snapshot) {
      if (series.name !== rule.metric) continue;
      if (!labelsMatch(series.labels, rule.matchLabels)) continue;
      const value = series.kind === 'histogram' ? series.max : series.value;
      observed = observed === null ? value : Math.max(observed, value);
    }
    if (observed === null) continue;
    if (!compare(observed, rule.comparator, rule.threshold)) continue;
    alerts.push({
      rule: rule.name,
      severity: rule.severity,
      metric: rule.metric,
      observed,
      threshold: rule.threshold,
      comparator: rule.comparator,
      message: rule.message,
    });
  }

  return alerts;
}

/**
 * Emit each firing alert through the structured log envelope, so alerts share
 * the same JSON line format as every other operational event and can be routed
 * to whatever the platform uses for alerting.
 */
export function emitAlerts(alerts: Alert[]): void {
  for (const alert of alerts) {
    logEnvelope('alert', { status: alert.severity }, `${alert.rule}: ${alert.message}`);
  }
}

// ---------------------------------------------------------------------------
// SINGLETON + TYPED RECORDERS
// ---------------------------------------------------------------------------

/** Process-wide registry. One per process; keyed by metric+labels. */
export const metrics = new MetricsRegistry();

/** A job entered the system (queued). */
export function recordJobStarted(labels?: Labels): void {
  metrics.increment(MetricNames.jobsStarted, labels);
}

/** A job reached a terminal success. */
export function recordJobCompleted(durationMs: number, labels?: Labels): void {
  metrics.increment(MetricNames.jobsCompleted, labels);
  metrics.observe(MetricNames.jobDuration, durationMs, labels);
}

/** A job reached a terminal failure, with the stage that failed. */
export function recordJobFailed(stage: string, labels?: Labels): void {
  metrics.increment(MetricNames.jobsFailed, { ...(labels || {}), stage });
}

/** One pipeline stage completed; `durationMs` feeds the stage histogram. */
export function recordStageDuration(stage: string, durationMs: number, labels?: Labels): void {
  metrics.observe(MetricNames.stageDuration, durationMs, { ...(labels || {}), stage });
}

/** A model provider call completed (latency) or failed (error counter). */
export function recordProviderCall(latencyMs: number, ok: boolean, labels?: Labels): void {
  metrics.observe(MetricNames.providerLatency, latencyMs, labels);
  if (!ok) metrics.increment(MetricNames.providerErrors, labels);
}

/** Current number of QUEUED jobs, as observed by the worker loop. */
export function recordQueueDepth(depth: number): void {
  metrics.setGauge(MetricNames.queueDepth, depth);
}

/** A lease expired and the job was returned to the queue. */
export function recordLeaseRecovery(count = 1): void {
  metrics.increment(MetricNames.leaseRecoveries, undefined, count);
}

/**
 * Citation-graph validation rejected a report. This is a critical signal: it
 * means a corrupt report was correctly prevented from being persisted.
 */
export function recordCitationFailure(jobId?: string): void {
  metrics.increment(MetricNames.citationFailures, jobId ? { job_id: jobId } : undefined);
}

/** A claim did not survive verification (contradicted or insufficient). */
export function recordVerificationFailure(count = 1): void {
  metrics.increment(MetricNames.verificationFailures, undefined, count);
}

/**
 * The realized cost of one completed job, in USD. Also persists the spend
 * into the CostStore (user-daily / user-monthly / global-daily buckets) so
 * the pre-job budget gate sees real totals across restarts and replicas.
 * `userId` is required for persistence; without it only the in-process
 * histogram is updated (fail-open, never throws).
 */
export function recordCostPerJob(costUsd: number, labels?: Labels, userId?: string): void {
  metrics.observe(MetricNames.costPerJob, costUsd, labels);
  if (userId && costUsd > 0) {
    const jobId = typeof labels?.job_id === 'string' ? labels.job_id : 'unknown';
    import('./cost_governor.js')
      .then((m) => new m.CostGovernor().recordJobCost(userId, jobId, costUsd))
      .catch(() => undefined);
  }
}

/**
 * One-shot operational summary for a metrics endpoint. Includes the alert
 * evaluation so a single scrape answers both "what are the numbers" and "is
 * anything on fire".
 */
export function observabilitySnapshot(): {
  metrics: MetricSeries[];
  alerts: Alert[];
  series_count: number;
} {
  return {
    metrics: metrics.snapshot(),
    alerts: evaluateAlerts(metrics),
    series_count: metrics.seriesCount(),
  };
}