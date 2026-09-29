import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtGuard } from '../auth/jwt.guard';
import { MINIMUM_ROLE_KEY } from '../auth/minimum-role.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminObservabilityController } from './admin-observability.controller';
import { AdminObservabilityService } from './admin-observability.service';

const envNames = [
  'PROMETHEUS_INTERNAL_URL',
  'LOKI_INTERNAL_URL',
  'JAEGER_INTERNAL_URL',
  'GRAFANA_INTERNAL_URL',
  'MINIO_INTERNAL_URL',
  'ANALYTICS_URL',
  'SEARCH_INDEXER_INTERNAL_URL',
] as const;
const originalFetch = global.fetch;
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]]),
);

const response = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const requestUrl = (input: string | URL | Request) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

afterEach(() => {
  global.fetch = originalFetch;
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Admin observability access', () => {
  it('requires both auth guards and the admin role', () => {
    expect(
      Reflect.getMetadata(MINIMUM_ROLE_KEY, AdminObservabilityController),
    ).toBe('admin');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminObservabilityController),
    ).toEqual([JwtGuard, RolesGuard]);
  });
});

describe('AdminObservabilityService', () => {
  beforeEach(() => {
    process.env.PROMETHEUS_INTERNAL_URL = 'http://prometheus:9090';
    process.env.LOKI_INTERNAL_URL = 'http://loki:3100';
    process.env.JAEGER_INTERNAL_URL = 'http://jaeger:16686';
    process.env.GRAFANA_INTERNAL_URL = 'http://grafana:3000';
    process.env.MINIO_INTERNAL_URL = 'http://minio:9000';
    process.env.ANALYTICS_URL = 'http://analytics:3000';
    process.env.SEARCH_INDEXER_INTERNAL_URL = 'http://search-indexer:9465';
  });

  it('parses safe metrics, log counts, targets, and tracing services', async () => {
    const metricValues = new Map([
      ['sum(rate(http_requests_total{job="api"}[1m]))', '2.5'],
      [
        '100 * sum(rate(http_requests_total{job="api",status=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total{job="api"}[5m])), 0.001)',
        '1.25',
      ],
      [
        'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="api"}[5m]))) * 1000',
        '123',
      ],
      ['active_workouts{job="api"}', '4'],
      ['outbox_unpublished_events{job="api"}', '5'],
      ['outbox_listener_connected{job="relay"}', '1'],
      ['sum(rate(outbox_publish_failures_total{job="relay"}[1m])) * 60', '0.5'],
      ['sum(analytics_consumer_lag{job="analytics"})', '6'],
      [
        'sum(increase(analytics_events_processed_total{job="analytics",result="retry"}[5m]))',
        '7',
      ],
      ['sum(increase(analytics_dlq_messages_total{job="analytics"}[5m]))', '8'],
      ['sum(pg_stat_activity_count)', '9'],
      ['sum(pg_database_size_bytes)', '1024'],
      ['max(pg_replication_lag)', '0.25'],
    ]);
    global.fetch = jest.fn((input: string | URL | Request) => {
      const url = new URL(requestUrl(input));
      if (url.pathname === '/api/v1/targets') {
        return Promise.resolve(
          response({
            data: {
              activeTargets: [
                'api',
                'relay',
                'analytics',
                'search',
                'postgres',
              ].map((job) => ({ labels: { job }, health: 'up' })),
            },
          }),
        );
      }
      if (url.pathname === '/api/v1/query' && url.hostname === 'prometheus') {
        return Promise.resolve(
          response({
            data: {
              result: [
                {
                  value: [0, metricValues.get(url.searchParams.get('query')!)],
                },
              ],
            },
          }),
        );
      }
      if (url.pathname === '/loki/api/v1/query') {
        return Promise.resolve(
          response({
            data: {
              result: [
                {
                  metric: { service: 'api', level: 'warn' },
                  value: [0, '3'],
                },
                {
                  metric: { service: 'api', level: 'error' },
                  value: [0, '2'],
                },
                {
                  metric: { service: 'relay', level: 'fatal' },
                  value: [0, '1'],
                },
                {
                  metric: { service: 'analytics', level: 'warn' },
                  value: [0, '4'],
                },
              ],
            },
          }),
        );
      }
      if (url.pathname === '/api/services') {
        return Promise.resolve(
          response({
            data: [
              'hit-api',
              'hit-relay',
              'hit-analytics',
              'hit-search-indexer',
              'internal-secret',
            ],
          }),
        );
      }
      return Promise.resolve(response('ok'));
    }) as typeof fetch;

    const result = await new AdminObservabilityService().summary();

    expect(result.metrics).toEqual({
      apiRequestsPerSecond: 2.5,
      apiErrorRatePercent: 1.25,
      apiP95LatencyMs: 123,
      activeWorkouts: 4,
      outboxBacklog: 5,
      outboxListenerConnected: true,
      outboxPublishFailuresPerMinute: 0.5,
      analyticsConsumerLag: 6,
      analyticsRetries5m: 7,
      analyticsDlq5m: 8,
      postgresConnections: 9,
      postgresDatabaseBytes: 1024,
      postgresReplicationLagSeconds: 0.25,
    });
    expect(result.logs).toEqual([
      { service: 'api', warnings5m: 3, errors5m: 2 },
      { service: 'relay', warnings5m: 0, errors5m: 1 },
      { service: 'analytics', warnings5m: 4, errors5m: 0 },
      { service: 'search-indexer', warnings5m: 0, errors5m: 0 },
    ]);
    expect(result.tracingServices).toEqual([
      'hit-api',
      'hit-relay',
      'hit-analytics',
      'hit-search-indexer',
    ]);
    expect(result.components.every(({ status }) => status === 'up')).toBe(true);
  });

  it('isolates failures and never exposes upstream details', async () => {
    global.fetch = jest.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.includes('analytics')) return Promise.resolve(response('ok'));
      if (url.includes('grafana'))
        return Promise.resolve(response('hidden', 503));
      throw new Error('TOP_SECRET http://prometheus:9090 internal failure');
    }) as typeof fetch;

    const result = await new AdminObservabilityService().summary();
    const statuses = Object.fromEntries(
      result.components.map(({ id, status }) => [id, status]),
    );

    expect(statuses.prometheus).toBe('down');
    expect(statuses.grafana).toBe('down');
    expect(statuses.minio).toBe('down');
    expect(statuses.analytics).toBe('up');
    expect(statuses['event-pipeline']).toBe('unknown');
    expect(JSON.stringify(result)).not.toMatch(
      /TOP_SECRET|prometheus:9090|internal failure|hidden/,
    );
  });
});
