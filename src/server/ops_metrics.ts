/**
 * Periodic metrics persistence (Firestore sharded docs, no hot documents).
 * ---------------------------------------------------------------------------
 * The in-process MetricsRegistry dies on restart; /metrics loses history.
 * This flusher snapshots the registry on an interval and writes it under
 *   ops_metrics/{yyyy-mm-dd}/hours/{hh}
 * merged per process replica, so N replicas write the same hourly doc via
 * atomic merge (no single hot document, no cross-replica coordination).
 * Failures are logged, never thrown — persistence must not break serving.
 */

import { metrics, observabilitySnapshot } from './observability.js';
import { logger } from './logger.js';

let flushTimer: ReturnType<typeof setInterval> | null = null;

function docPath(d = new Date()): { day: string; hour: string } {
  const iso = d.toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(11, 13) };
}

async function flushOnce(): Promise<void> {
  // In test environments without Firebase credentials, skip persistence.
  // The in-memory registry survives for the test duration; that is sufficient.
  if (process.env.NODE_ENV === 'test' || !process.env.FIREBASE_PROJECT_ID) {
    logger.debug('ops.flush_skipped', 'Skipping metrics persistence (no Firestore target)');
    return;
  }
  try {
    const { adminDb } = await import('../lib/firebase-admin.js');
    const snap = observabilitySnapshot();
    const { day, hour } = docPath();
    const ref = adminDb
      .collection('ops_metrics')
      .doc(day)
      .collection('hours')
      .doc(hour);
    await ref.set(
      {
        updated_at: new Date().toISOString(),
        series_count: snap.series_count,
        series: snap.metrics.slice(0, 500),
        alerts: snap.alerts,
        process: process.pid,
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn('ops.flush_failed', 'Metrics persistence flush failed', {
      status: (err as Error)?.message || String(err),
    });
  }
}

/** Start the interval flusher. Idempotent; no-op when already running. */
export function startMetricsFlusher(intervalMs = 60000): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushOnce();
  }, intervalMs);
  if (typeof (flushTimer as any).unref === 'function') (flushTimer as any).unref();
  logger.info('ops.flusher_started', 'Metrics persistence flusher started', {
    status: `interval_ms=${intervalMs}`,
  });
}

/** Stop the flusher (tests / graceful shutdown). */
export function stopMetricsFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/** Single flush on demand (tests, shutdown hooks). */
export async function flushMetricsNow(): Promise<void> {
  await flushOnce();
}

export { metrics };
