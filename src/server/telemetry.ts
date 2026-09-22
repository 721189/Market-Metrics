import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { logger } from './logger.js';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => logger.info('telemetry.shutdown', 'Tracing terminated'))
    .catch((error) => logger.error('telemetry.shutdown_failed', 'Error terminating tracing', {
      status: (error as Error)?.message || String(error),
    }))
    .finally(() => process.exit(0));
});
