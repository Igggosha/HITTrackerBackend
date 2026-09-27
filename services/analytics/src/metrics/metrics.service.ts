import { Injectable } from '@nestjs/common';
import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  /** result: applied | duplicate | ignored | erased_user | skipped_unknown | dead_lettered | retry */
  readonly eventsProcessed = new Counter({
    name: 'analytics_events_processed_total',
    help: 'Kafka messages handled by the analytics consumer, by event type and result.',
    labelNames: ['type', 'result'] as const,
    registers: [this.registry],
  });
  readonly processingSeconds = new Histogram({
    name: 'analytics_event_processing_seconds',
    help: 'Time to handle one Kafka message, including retries and the DB transaction.',
    labelNames: ['type'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 10],
    registers: [this.registry],
  });
  readonly consumerLag = new Gauge({
    name: 'analytics_consumer_lag',
    help: 'Messages not yet committed by the analytics consumer group (high watermark - committed offset).',
    labelNames: ['topic', 'partition'] as const,
    registers: [this.registry],
  });
  readonly deadLettered = new Counter({
    name: 'analytics_dlq_messages_total',
    help: 'Messages the analytics consumer sent to hit.events.dlq.',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });
  readonly httpRequests = new Counter({
    name: 'analytics_http_requests_total',
    help: 'HTTP requests handled by the analytics read API.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Same bearer-token rule as the main API's `/metrics`. */
  authorized(authorization?: string): boolean {
    const token = process.env.METRICS_TOKEN;
    if (
      !token ||
      token.length < 24 ||
      token === 'change_me' ||
      !authorization?.startsWith('Bearer ')
    )
      return false;
    const supplied = Buffer.from(authorization.slice(7));
    const expected = Buffer.from(token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }
}
