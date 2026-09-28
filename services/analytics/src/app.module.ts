import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsQueryService } from './analytics/analytics-query.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { logMixin } from './common/log-context';
import { loadConfig, type AnalyticsConfig } from './config/environment';
import { DeadLetterProducer } from './consumer/dead-letter.producer';
import {
  createKafka,
  KAFKA,
  KafkaConsumerService,
} from './consumer/kafka-consumer.service';
import {
  DEAD_LETTER_PUBLISHER,
  HANDLER_CONFIG,
  MessageHandler,
  type DeadLetterPublisher,
  type HandlerConfig,
} from './consumer/message-handler';
import { DatabaseModule } from './db/database';
import { EventValidator } from './events/event-validator';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { PgReadModelStore } from './projections/pg-read-model-store';
import { Projector } from './projections/projector';
import { READ_MODEL_STORE } from './projections/read-model-store';
import { TracingShutdownModule } from './tracing/tracing-shutdown.module';

export const CONFIG = Symbol('CONFIG');

@Module({
  imports: [
    DatabaseModule,
    TracingShutdownModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: process.env.JWT_SECRET }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Same JSON shape as the main API, so Alloy/Loki parse both alike.
        genReqId: (req) => (req as Request & { id: string }).id,
        mixin: logMixin,
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: {
          ignore: (req) =>
            ['/metrics', '/health'].includes(req.url?.split('?')[0] ?? ''),
        },
        serializers: {
          req: (req: Request) => ({
            method: req.method,
            url: req.url.split('?')[0],
          }),
          res: (res: Response) => ({ statusCode: res.statusCode }),
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[Redacted]',
        },
      },
    }),
  ],
  controllers: [AnalyticsController, HealthController, MetricsController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: HANDLER_CONFIG,
      inject: [CONFIG],
      useFactory: (config: AnalyticsConfig): HandlerConfig => ({
        maxAttempts: config.maxAttempts,
        retryBaseMs: config.retryBaseMs,
        retryMaxMs: config.retryMaxMs,
      }),
    },
    {
      provide: KAFKA,
      inject: [CONFIG],
      useFactory: (config: AnalyticsConfig) =>
        config.kafkaBrokers.length ? createKafka(config.kafkaBrokers) : null,
    },
    { provide: EventValidator, useFactory: () => new EventValidator() },
    { provide: READ_MODEL_STORE, useClass: PgReadModelStore },
    DeadLetterProducer,
    {
      provide: DEAD_LETTER_PUBLISHER,
      inject: [DeadLetterProducer],
      useFactory:
        (producer: DeadLetterProducer): DeadLetterPublisher =>
        (message) =>
          producer.publish(message),
    },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    MetricsService,
    Projector,
    MessageHandler,
    KafkaConsumerService,
    AnalyticsQueryService,
    JwtAuthGuard,
  ],
})
export class AppModule {}
