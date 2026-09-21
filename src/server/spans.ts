/**
 * Lightweight span instrumentation (zero dependencies).
 * ---------------------------------------------------------------------------
 * Formalizes the stage/Gemini/fetch durations the pipeline already records
 * into one unit: startSpan(name, attrs) -> span.end(extra?) emits BOTH a
 * metric observation (stage histogram when the span is a pipeline stage,
 * provider latency when it is a provider call) AND a structured logger line
 * carrying duration_ms. Spans nest via parent job_id/stage attrs; they never
 * allocate threads, sample, or export — Railway drains the JSON lines.
 */

import { logger, type LogFields } from './logger.js';
import { recordProviderCall, recordStageDuration } from './observability.js';

export interface SpanOptions {
  job_id?: string;
  stage?: string;
  operation?: string;
  provider?: boolean;
  attrs?: LogFields;
}

export interface Span {
  readonly name: string;
  readonly startedAt: number;
  end(extra?: LogFields): number;
}

export function startSpan(name: string, opts: SpanOptions = {}): Span {
  const startedAt = Date.now();
  return {
    name,
    startedAt,
    end(extra: LogFields = {}): number {
      const durationMs = Date.now() - startedAt;
      const fields: LogFields = {
        duration_ms: durationMs,
        ...(opts.job_id ? { job_id: opts.job_id } : {}),
        ...(opts.stage ? { stage: opts.stage } : {}),
        ...(opts.attrs || {}),
        ...extra,
      };
      if (opts.provider) {
        recordProviderCall(durationMs, true, {
          operation: opts.operation || name,
          ...(opts.job_id ? { job_id: opts.job_id } : {}),
        });
        logger.info('span.provider', `${name} completed`, fields);
      } else if (opts.stage) {
        recordStageDuration(opts.stage, durationMs, {
          ...(opts.job_id ? { job_id: opts.job_id } : {}),
        });
        logger.info('span.stage', `${name} completed`, fields);
      } else {
        logger.info('span.completed', `${name} completed`, fields);
      }
      return durationMs;
    },
  };
}

/**
 * Failure terminal for a span: records the provider error counter when the
 * span is a provider span, and always emits an error log line with
 * duration_ms so failures are as queryable as successes.
 */
export function endSpanWithError(
  span: Span,
  err: unknown,
  opts: SpanOptions = {},
): number {
  const durationMs = Date.now() - span.startedAt;
  const message = (err as Error)?.message || String(err);
  if (opts.provider) {
    recordProviderCall(durationMs, false, {
      operation: opts.operation || span.name,
      reason: message.slice(0, 120),
      ...(opts.job_id ? { job_id: opts.job_id } : {}),
    });
  }
  logger.error('span.failed', `${span.name} failed`, {
    duration_ms: durationMs,
    status: message,
    ...(opts.job_id ? { job_id: opts.job_id } : {}),
    ...(opts.stage ? { stage: opts.stage } : {}),
  });
  return durationMs;
}
