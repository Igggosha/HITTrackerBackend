import '../tracing/register';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as http from 'node:http';
import { SearchIndexerModule } from './search-indexer.module';
import { MetricsService } from '../metrics/metrics.service';
import { IndexWriterService } from './index-writer.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SearchIndexerModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  app.enableShutdownHooks();
  const metrics = app.get(MetricsService);
  const writer = app.get(IndexWriterService);
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      void writer
        .health()
        .then(({ healthy }) =>
          response
            .writeHead(healthy ? 200 : 503)
            .end(healthy ? 'ok' : 'unavailable'),
        )
        .catch(() => response.writeHead(503).end('unavailable'));
      return;
    }
    if (request.url !== '/metrics') return void response.writeHead(404).end();
    const authorization = Array.isArray(request.headers.authorization)
      ? undefined
      : request.headers.authorization;
    if (!metrics.authorized(authorization))
      return void response.writeHead(401).end();
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
  server.listen(
    Number(process.env.SEARCH_INDEXER_METRICS_PORT ?? 9465),
    '0.0.0.0',
  );
  const close = () => server.close();
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}
void bootstrap();
