import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import httpMetrics from './common/http-metrics';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-id';
import { loadConfig } from './config/environment';
import { MetricsService } from './metrics/metrics.service';

async function bootstrap() {
  const config = loadConfig(); // fail fast before anything connects
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.use(requestIdMiddleware);
  app.use(httpMetrics(app.get(MetricsService)));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(config.port, '0.0.0.0');
}
void bootstrap();
