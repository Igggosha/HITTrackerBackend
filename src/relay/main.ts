import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import * as http from 'node:http';
import { RelayModule } from './relay.module';
import { validateRelayEnvironment } from '../config/environment';
import { MetricsService } from '../metrics/metrics.service';

const DEFAULT_RELAY_METRICS_PORT = 9464;

/**
 * A minimal `/metrics` scrape endpoint for the standalone relay process.
 *
 * The API's own `MetricsController` is unreachable here (this process has no
 * HTTP server otherwise), yet `outbox_published_total`/
 * `outbox_publish_failures_total` only ever change in this process. This
 * reuses the same `MetricsService` registry and the same bearer-token check
 * as the API's `/metrics` endpoint (`MetricsService.authorized`), and adds no
 * new dependency (`node:http`). Compose does not publish a host port for it:
 * it is reachable only from other containers on the private network, such as
 * Prometheus's `relay` scrape job.
 */
function startMetricsServer(metrics: MetricsService): http.Server {
  const port = Number(
    process.env.RELAY_METRICS_PORT ?? DEFAULT_RELAY_METRICS_PORT,
  );
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    const authorization = Array.isArray(request.headers.authorization)
      ? undefined
      : request.headers.authorization;
    if (!metrics.authorized(authorization)) {
      response.writeHead(401).end();
      return;
    }
    metrics
      .metrics()
      .then((body) => {
        response.writeHead(200, {
          'content-type': metrics.registry.contentType,
        });
        response.end(body);
      })
      .catch(() => response.writeHead(500).end());
  });
  server.listen(port, '0.0.0.0');
  return server;
}

async function bootstrap() {
  // No ConfigModule runs in this standalone process, so relay-specific
  // variables must be validated here the same way `validateEnvironment`
  // validates them for the in-process (API) relay: invalid -> fail fast at
  // boot instead of misbehaving quietly at the first poll.
  validateRelayEnvironment(process.env);

  const app = await NestFactory.createApplicationContext(RelayModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  app.enableShutdownHooks();

  const metricsServer = startMetricsServer(app.get(MetricsService));
  const closeMetricsServer = () => metricsServer.close();
  process.on('SIGTERM', closeMetricsServer);
  process.on('SIGINT', closeMetricsServer);
}
void bootstrap();
