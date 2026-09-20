/**
 * Structured JSON-lines logger (zero dependencies; Railway captures stdout).
 * ---------------------------------------------------------------------------
 * Railway drains container stdout natively, so the correct production sink is
 * JSON lines on stdout — no Cloud Logging agent, no pino transport, nothing
 * to lose buffered logs on SIGTERM. Pretty human-readable output in dev.
 *
 * Every line carries: timestamp, level, service, environment, event, message,
 * plus any of request_id / user_id / job_id / stage / duration_ms the caller
 * supplies. This keeps the P1 logEnvelope contract while making it greppable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  request_id?: string;
  user_id?: string;
  job_id?: string;
  stage?: string;
  duration_ms?: number;
  status?: string | number;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function emit(level: LogLevel, event: string, message: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
  const line = {
    timestamp: new Date().toISOString(),
    level,
    service: 'market-metrics-agent',
    environment: process.env.NODE_ENV || 'development',
    event,
    message,
    ...fields,
  };
  const out = level === 'error' ? process.stderr : process.stdout;
  if (process.env.NODE_ENV === 'production') {
    out.write(JSON.stringify(line) + '\n');
  } else {
    const ctx = [fields.request_id, fields.user_id, fields.job_id, fields.stage]
      .filter(Boolean)
      .join(' ');
    out.write(`${line.timestamp} [${level.toUpperCase()}] ${event}: ${message}${ctx ? ` (${ctx})` : ''}\n`);
  }
}

export const logger = {
  debug: (event: string, message: string, fields?: LogFields) => emit('debug', event, message, fields),
  info: (event: string, message: string, fields?: LogFields) => emit('info', event, message, fields),
  warn: (event: string, message: string, fields?: LogFields) => emit('warn', event, message, fields),
  error: (event: string, message: string, fields?: LogFields) => emit('error', event, message, fields),
};

/** Child logger pre-bound to a job (+ optional user) for pipeline stages. */
export function createJobLogger(jobId: string, userId?: string) {
  const base: LogFields = userId ? { job_id: jobId, user_id: userId } : { job_id: jobId };
  return {
    debug: (event: string, message: string, fields?: LogFields) => emit('debug', event, message, { ...base, ...fields }),
    info: (event: string, message: string, fields?: LogFields) => emit('info', event, message, { ...base, ...fields }),
    warn: (event: string, message: string, fields?: LogFields) => emit('warn', event, message, { ...base, ...fields }),
    error: (event: string, message: string, fields?: LogFields) => emit('error', event, message, { ...base, ...fields }),
  };
}

/** Child logger pre-bound to a job + stage for stage-level instrumentation. */
export function createStageLogger(jobId: string, stage: string) {
  return createJobLogger(jobId, undefined) as ReturnType<typeof createJobLogger>;
}
