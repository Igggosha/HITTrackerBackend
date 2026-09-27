import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import type { Request, Response } from 'express';
import { AuthModule } from './auth/auth.module';
import { WorkoutProgramsModule } from './workout-programs/workout-programs.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { ExercisesModule } from './exercises/exercises.module';
import { UsersModule } from './users/users.module';
import { OutboxModule } from './outbox/outbox.module';
import { RelayModule } from './relay/relay.module';
import { AppController } from './app.controller';
import { validateEnvironment } from './config/environment';
import { MetricsModule } from './metrics/metrics.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { requestIds } from './common/request-id';
import { context, trace } from '@opentelemetry/api';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => req.id,
        mixin: () => {
          const span = trace.getSpanContext(context.active());
          return {
            requestId: requestIds.getStore() ?? 'system',
            traceId: span?.traceId ?? null,
            spanId: span?.spanId ?? null,
          };
        },
        // The Prometheus scrape hits GET /metrics every 15s (see
        // docker/observability/prometheus/prometheus.yml); logging each of
        // those requests would drown real traffic in access-log noise. The
        // req/res serializers below never emit a `headers` key, so the
        // scrape's `Authorization: Bearer <token>` is never logged either
        // way, but the request is still excluded outright.
        autoLogging: {
          ignore: (req) => req.url?.split('?')[0] === '/metrics',
        },
        serializers: {
          req: (req: Request) => ({
            method: req.method,
            url: req.url.split('?')[0],
          }),
          res: (res: Response) => ({ statusCode: res.statusCode }),
        },
        redact: {
          // The `req`/`res` serializers above never emit a `headers` key, so
          // the `req.headers.*`/`res.headers.*` paths below are currently
          // unreachable dead config. They stay anyway, as defense in depth
          // in case a serializer is ever changed or removed; the field-name
          // paths cover password/token/code wherever they surface in other
          // logged objects (e.g. request bodies passed to `logger.error`).
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers.set-cookie',
            'password',
            'token',
            'code',
            '*.password',
            '*.token',
            '*.code',
            '*.*.password',
            '*.*.token',
            '*.*.code',
          ],
          censor: '[Redacted]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true } },
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          port: Number(config.get('MAIL_PORT')),
          secure: false,
          auth: {
            user: config.get<string>('MAIL_USER'),
            pass: config.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: config.get<string>('MAIL_FROM'),
        },
      }),
    }),
    OutboxModule,
    RelayModule,
    AuthModule,
    WorkoutProgramsModule,
    WorkoutsModule,
    ExercisesModule,
    UsersModule,
    MetricsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
// The request-id middleware is registered directly in `configureApp`
// (`src/config/configure-app.ts`), as the very first `app.use(...)` in
// bootstrap — before helmet and the body parsers. Nest only applies
// module-bound middleware (what `NestModule.configure` would add here) once
// the app initialises, which happens after every explicit `app.use(...)`
// call in `main.ts`. Binding it here too would run it a second time, too
// late to cover pre-routing failures.
export class AppModule {}
