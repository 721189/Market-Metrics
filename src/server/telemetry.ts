import { logger } from './logger.js';

const ENABLED = String(process.env.OTEL_ENABLED ?? 'false').toLowerCase() === 'true';

type ShutdownFn = () => Promise<void>;
let shutdownSdk: ShutdownFn = () => Promise.resolve();

/**
 * OpenTelemetry is an optional production concern. The auto-instrumentation
 * graph pulls modern runtime APIs that crash tsx's module evaluation on
 * Node 20, so both the imports and the SDK construction must happen here,
 * lazily, and only when an operator explicitly opts in with OTEL_ENABLED=1.
 */
export async function initTelemetry(): Promise<void> {
  if (!ENABLED || process.env.NODE_ENV === 'test') return;
  try {
    const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/auto-instrumentations-node'),
        import('@opentelemetry/exporter-trace-otlp-proto'),
      ]);
    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
    shutdownSdk = () => sdk.shutdown();
    logger.info('telemetry.init', 'OpenTelemetry tracing started');
  } catch (error) {
    logger.error('telemetry.init_failed', 'OpenTelemetry disabled after failed init', {
      status: (error as Error)?.message || String(error),
    });
  }
}

process.on('SIGTERM', () => {
  shutdownSdk()
    .then(() => logger.info('telemetry.shutdown', 'Tracing terminated'))
    .catch((error) => logger.error('telemetry.shutdown_failed', 'Error terminating tracing', {
      status: (error as Error)?.message || String(error),
    }))
    .finally(() => process.exit(0));
});
