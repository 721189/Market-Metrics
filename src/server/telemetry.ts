import { EventEmitter } from 'events';

/**
 * OpenTelemetry (OTEL) Mock Integration
 * Collects metrics and traces across pipeline stages, providing
 * Prometheus/Grafana ready export formats.
 */
export class OpenTelemetryEngine {
  private static spans: any[] = [];
  private static metrics = new Map<string, number>();
  public static emitter = new EventEmitter();

  public static startSpan(name: string, attributes?: Record<string, any>) {
    const spanId = `span-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const startTime = Date.now();
    return {
      spanId,
      end: (status: 'OK' | 'ERROR' = 'OK') => {
        const duration = Date.now() - startTime;
        this.spans.push({
          id: spanId,
          name,
          durationMs: duration,
          status,
          attributes,
          timestamp: new Date().toISOString()
        });
        if (this.spans.length > 1000) this.spans.shift();
        this.emitter.emit('span_ended', { name, duration, status });
      }
    };
  }

  public static incrementCounter(name: string, value = 1) {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + value);
  }

  public static recordHistogram(name: string, value: number) {
    // In a real OTEL setup, this records to a histogram metric
    // For now, just maintain a rolling average
    const currentStr = this.metrics.get(`${name}_sum`) || 0;
    const countStr = this.metrics.get(`${name}_count`) || 0;
    this.metrics.set(`${name}_sum`, currentStr + value);
    this.metrics.set(`${name}_count`, countStr + 1);
  }

  public static exportMetrics() {
    const exported: Record<string, number> = {};
    for (const [k, v] of this.metrics.entries()) {
      exported[k] = v;
    }
    return {
      metrics: exported,
      recent_spans: this.spans.slice(-100)
    };
  }
}
