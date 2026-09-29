import { Injectable } from '@nestjs/common';
import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../db/db';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });
  readonly duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  // A connection that closes before the response finishes (client
  // disconnect, proxy reset, ...) never gets a status code, so it is kept
  // out of `http_requests_total`/`http_request_duration_seconds` and counted
  // here instead of being guessed into some status bucket.
  readonly aborted = new Counter({
    name: 'http_requests_aborted_total',
    help: 'HTTP requests whose connection closed before the response finished.',
    labelNames: ['method', 'route'] as const,
    registers: [this.registry],
  });
  readonly outboxPublished = new Counter({
    name: 'outbox_published_total',
    help: 'Outbox events published to their normal topic.',
    registers: [this.registry],
  });
  readonly outboxPublishFailures = new Counter({
    name: 'outbox_publish_failures_total',
    help: 'Outbox or DLQ publish failures.',
    registers: [this.registry],
  });
  readonly outboxListenerConnected = new Gauge({
    name: 'outbox_listener_connected',
    help: 'Whether the relay is listening for committed outbox events.',
    registers: [this.registry],
  });
  readonly outboxRelayWakeups = new Counter({
    name: 'outbox_relay_wakeups_total',
    help: 'Relay wakeups by source.',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });
  readonly searchRequests = new Counter({
    name: 'catalog_search_requests_total',
    help: 'Catalog search requests by safe outcome; query text is never a label.',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });
  readonly searchDuration = new Histogram({
    name: 'catalog_search_duration_seconds',
    help: 'Catalog search duration without query text labels.',
    labelNames: ['result'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [this.registry],
  });
  readonly searchIndexerEvents = new Counter({
    name: 'search_indexer_events_total',
    help: 'Validated search projection events by safe type and result.',
    labelNames: ['type', 'result'] as const,
    registers: [this.registry],
  });
  readonly searchIndexerRetries = new Counter({
    name: 'search_indexer_retries_total',
    help: 'Search projection retries by event type.',
    labelNames: ['type'] as const,
    registers: [this.registry],
  });
  readonly searchIndexerDlq = new Counter({
    name: 'search_indexer_dlq_total',
    help: 'Search projection dead letters by reason.',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });
  readonly searchIndexerLag = new Gauge({
    name: 'search_indexer_consumer_lag',
    help: 'Uncommitted catalog messages by topic and partition.',
    labelNames: ['topic', 'partition'] as const,
    registers: [this.registry],
  });
  readonly searchElasticsearchHealthy = new Gauge({
    name: 'search_elasticsearch_healthy',
    help: 'Whether the indexer can reach a non-red Elasticsearch cluster.',
    registers: [this.registry],
  });
  readonly searchDocuments = new Gauge({
    name: 'search_documents',
    help: 'Visible documents in the active search indices.',
    labelNames: ['section'] as const,
    registers: [this.registry],
  });

  private activeWorkoutsGauge: Gauge<string>;
  private activeWorkouts = 0;
  private activeWorkoutsFetchedAt = 0;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    new Gauge({
      name: 'outbox_unpublished_events',
      help: 'Outbox rows awaiting normal or DLQ delivery.',
      registers: [this.registry],
      collect: async function () {
        try {
          const result = await pool.query<{ count: string }>(
            'select count(*) as count from outbox_events where published_at is null',
          );
          this.set(Number(result.rows[0]?.count ?? 0));
        } catch {
          /* retain last value during database outages */
        }
      },
    });
    this.activeWorkoutsGauge = new Gauge({
      name: 'active_workouts',
      help: 'Workouts currently active.',
      registers: [this.registry],
      collect: async () => {
        if (Date.now() - this.activeWorkoutsFetchedAt > 15_000) {
          try {
            const result = await pool.query<{ count: string }>(
              "select count(*) as count from workouts where status = 'active'",
            );
            this.activeWorkouts = Number(result.rows[0]?.count ?? 0);
            this.activeWorkoutsFetchedAt = Date.now();
          } catch {
            // Keep the last cached value and serve process metrics through outages.
          }
        }
        this.activeWorkoutsGauge.set(this.activeWorkouts);
      },
    });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

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
