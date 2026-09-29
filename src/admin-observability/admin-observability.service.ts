import { Injectable } from '@nestjs/common';

type Status = 'up' | 'down' | 'unknown';
type ComponentId =
  | 'api'
  | 'relay'
  | 'analytics'
  | 'search'
  | 'postgres'
  | 'prometheus'
  | 'loki'
  | 'jaeger'
  | 'grafana'
  | 'minio'
  | 'event-pipeline';

const timeoutMs = 1_500;
const componentIds: ComponentId[] = [
  'api',
  'relay',
  'analytics',
  'search',
  'postgres',
  'prometheus',
  'loki',
  'jaeger',
  'grafana',
  'minio',
  'event-pipeline',
];
const traceServices = new Set([
  'hit-api',
  'hit-relay',
  'hit-analytics',
  'hit-search-indexer',
  'jaeger-all-in-one',
]);
const metricQueries = [
  'sum(rate(http_requests_total{job="api"}[1m]))',
  '100 * sum(rate(http_requests_total{job="api",status=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total{job="api"}[5m])), 0.001)',
  'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="api"}[5m]))) * 1000',
  'active_workouts{job="api"}',
  'outbox_unpublished_events{job="api"}',
  'outbox_listener_connected{job="relay"}',
  'sum(rate(outbox_publish_failures_total{job="relay"}[1m])) * 60',
  'sum(analytics_consumer_lag{job="analytics"})',
  'sum(increase(analytics_events_processed_total{job="analytics",result="retry"}[5m]))',
  'sum(increase(analytics_dlq_messages_total{job="analytics"}[5m]))',
  'sum(pg_stat_activity_count)',
  'sum(pg_database_size_bytes)',
  'max(pg_replication_lag)',
] as const;

@Injectable()
export class AdminObservabilityService {
  async summary() {
    const [
      prometheus,
      loki,
      jaeger,
      grafana,
      minio,
      analyticsProbe,
      searchProbe,
    ] = await Promise.all([
      this.prometheus(),
      this.loki(),
      this.jaeger(),
      this.probe('GRAFANA_INTERNAL_URL', '/api/health'),
      this.probe('MINIO_INTERNAL_URL', '/minio/health/live'),
      this.probe('ANALYTICS_URL', '/health'),
      this.probe('SEARCH_INDEXER_INTERNAL_URL', '/health'),
    ]);

    const analytics = this.combineStatus(
      prometheus.targets.analytics,
      analyticsProbe,
    );
    const api = prometheus.targets.api === 'down' ? 'down' : ('up' as const);
    const statuses: Record<ComponentId, Status> = {
      api,
      relay: prometheus.targets.relay,
      analytics,
      search: this.combineStatus(prometheus.targets.search, searchProbe),
      postgres: prometheus.targets.postgres,
      prometheus: prometheus.status,
      loki: loki.status,
      jaeger: jaeger.status,
      grafana: this.probeStatus(grafana),
      minio: this.probeStatus(minio),
      'event-pipeline': this.pipelineStatus(
        prometheus.targets.relay,
        analytics,
      ),
    };

    return {
      generatedAt: new Date().toISOString(),
      components: componentIds.map((id) => ({ id, status: statuses[id] })),
      metrics: prometheus.metrics,
      logs: loki.logs,
      tracingServices: jaeger.services,
    };
  }

  private emptyMetrics() {
    return {
      apiRequestsPerSecond: null as number | null,
      apiErrorRatePercent: null as number | null,
      apiP95LatencyMs: null as number | null,
      activeWorkouts: null as number | null,
      outboxBacklog: null as number | null,
      outboxListenerConnected: null as boolean | null,
      outboxPublishFailuresPerMinute: null as number | null,
      analyticsConsumerLag: null as number | null,
      analyticsRetries5m: null as number | null,
      analyticsDlq5m: null as number | null,
      postgresConnections: null as number | null,
      postgresDatabaseBytes: null as number | null,
      postgresReplicationLagSeconds: null as number | null,
    };
  }

  private async fetchJson(url: string): Promise<unknown> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  private async fetchStatus(url: string): Promise<boolean> {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
    } catch {
      return false;
    }
  }

  private url(base: string, path: string) {
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private async probe(env: string, path: string): Promise<boolean | null> {
    const base = process.env[env];
    return base ? this.fetchStatus(this.url(base, path)) : null;
  }

  private probeStatus(result: boolean | null): Status {
    return result === null ? 'unknown' : result ? 'up' : 'down';
  }

  private combineStatus(primary: Status, probe: boolean | null): Status {
    if (primary === 'down' || probe === false) return 'down';
    if (primary === 'up' || probe === true) return 'up';
    return 'unknown';
  }

  private pipelineStatus(relay: Status, analytics: Status): Status {
    if (relay === 'down' || analytics === 'down') return 'down';
    return relay === 'up' && analytics === 'up' ? 'up' : 'unknown';
  }

  private async query(base: string, expression: string) {
    const data = (await this.fetchJson(
      `${this.url(base, '/api/v1/query')}?query=${encodeURIComponent(expression)}`,
    )) as { data?: { result?: Array<{ value?: [unknown, unknown] }> } } | null;
    const value = data?.data?.result?.[0]?.value?.[1];
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async prometheus() {
    const metrics = this.emptyMetrics();
    const targets: Record<
      'api' | 'relay' | 'analytics' | 'search' | 'postgres',
      Status
    > = {
      api: 'unknown',
      relay: 'unknown',
      analytics: 'unknown',
      search: 'unknown',
      postgres: 'unknown',
    };
    const base = process.env.PROMETHEUS_INTERNAL_URL;
    if (!base) return { status: 'unknown' as Status, metrics, targets };

    const [healthy, targetData, ...values] = await Promise.all([
      this.fetchStatus(this.url(base, '/-/healthy')),
      this.fetchJson(this.url(base, '/api/v1/targets')),
      ...metricQueries.map((expression) => this.query(base, expression)),
    ]);
    const activeTargets = (
      targetData as {
        data?: {
          activeTargets?: Array<{
            labels?: { job?: unknown };
            health?: unknown;
          }>;
        };
      } | null
    )?.data?.activeTargets;
    for (const target of activeTargets ?? []) {
      const job = target.labels?.job;
      if (typeof job === 'string' && job in targets) {
        targets[job as keyof typeof targets] =
          target.health === 'up' ? 'up' : 'down';
      }
    }

    [
      metrics.apiRequestsPerSecond,
      metrics.apiErrorRatePercent,
      metrics.apiP95LatencyMs,
      metrics.activeWorkouts,
      metrics.outboxBacklog,
      metrics.outboxListenerConnected,
      metrics.outboxPublishFailuresPerMinute,
      metrics.analyticsConsumerLag,
      metrics.analyticsRetries5m,
      metrics.analyticsDlq5m,
      metrics.postgresConnections,
      metrics.postgresDatabaseBytes,
      metrics.postgresReplicationLagSeconds,
    ] = [
      values[0],
      values[1],
      values[2],
      values[3],
      values[4],
      values[5] === null ? null : values[5] > 0,
      values[6],
      values[7],
      values[8],
      values[9],
      values[10],
      values[11],
      values[12],
    ];
    return {
      status: healthy ? ('up' as Status) : ('down' as Status),
      metrics,
      targets,
    };
  }

  private async loki() {
    const logs = ['api', 'relay', 'analytics', 'search-indexer'].map(
      (service) => ({
        service,
        warnings5m: 0,
        errors5m: 0,
      }),
    );
    const base = process.env.LOKI_INTERNAL_URL;
    if (!base) return { status: 'unknown' as Status, logs: [] as typeof logs };
    const expression =
      'sum by (service, level) (count_over_time({service=~"api|relay|analytics|search-indexer", level=~"warn|error|fatal"}[5m]))';
    const data = (await this.fetchJson(
      `${this.url(base, '/loki/api/v1/query')}?query=${encodeURIComponent(expression)}`,
    )) as {
      data?: {
        result?: Array<{
          metric?: { service?: unknown; level?: unknown };
          value?: [unknown, unknown];
        }>;
      };
    } | null;
    if (!data) return { status: 'down' as Status, logs: [] as typeof logs };
    for (const item of data.data?.result ?? []) {
      const service = item.metric?.service;
      const level = item.metric?.level;
      const target = logs.find((entry) => entry.service === service);
      const count = Number(item.value?.[1]);
      if (!target || !Number.isFinite(count)) continue;
      if (level === 'warn') target.warnings5m += count;
      if (level === 'error' || level === 'fatal') target.errors5m += count;
    }
    return { status: 'up' as Status, logs };
  }

  private async jaeger() {
    const base = process.env.JAEGER_INTERNAL_URL;
    if (!base) return { status: 'unknown' as Status, services: [] as string[] };
    const data = (await this.fetchJson(this.url(base, '/api/services'))) as {
      data?: unknown;
    } | null;
    if (!data) return { status: 'down' as Status, services: [] as string[] };
    const services = Array.isArray(data.data)
      ? data.data.filter(
          (value): value is string =>
            typeof value === 'string' && traceServices.has(value),
        )
      : [];
    return { status: 'up' as Status, services };
  }
}
