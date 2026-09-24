import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import type { Express } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { isCorsOriginAllowed } from './config/cors';
import { configureTrustProxy } from './config/trust-proxy';
import { pool } from './db/db';
import { BODY_METRIC_RANGES } from './users/body-metrics';

function validationException(errors: ValidationError[]) {
  const targetName = errors.find((error) => error.target)?.target?.constructor
    .name;
  if (targetName === 'CreateBodyMetricDto') {
    const details = errors.flatMap((error) => {
      const constraint = Object.keys(error.constraints ?? {}).find((key) =>
        ['min', 'max'].includes(key),
      );
      if (!constraint) return [];
      const range = BODY_METRIC_RANGES[
        error.property as keyof typeof BODY_METRIC_RANGES
      ];
      return range
        ? [
            {
              field: error.property,
              code: 'OUT_OF_RANGE',
              min: range.min,
              max: range.max,
            },
          ]
        : [];
    });
    if (details.length) {
      return new BadRequestException({
        code: 'BODY_METRIC_OUT_OF_RANGE',
        details,
      });
    }
    if (errors.some((error) => error.property === 'recordedAt')) {
      return new BadRequestException({ code: 'BODY_METRIC_INVALID_DATE' });
    }
    return new BadRequestException({ code: 'BODY_METRIC_INVALID' });
  }
  if (targetName === 'ListBodyMetricsDto') {
    return new BadRequestException({ code: 'INVALID_PERIOD' });
  }
  return new BadRequestException(errors);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Cloudflare Tunnel is the only public hop; secure OAuth cookies need its HTTPS signal.
  configureTrustProxy(
    app.getHttpAdapter().getInstance() as Express,
    process.env.NODE_ENV === 'production',
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: validationException,
    }),
  );
  app.use(helmet());
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));

  const PostgresSessionStore = connectPgSimple(session);

  app.use(
    session({
      store: new PostgresSessionStore({
        pool,
        tableName: 'oauth_sessions',
        createTableIfMissing: false,
      }),
      secret: process.env.OAUTH_SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 10 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow: boolean) => void,
    ) => callback(null, isCorsOriginAllowed(origin)),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders:
      'Content-Type, Accept, Authorization, X-Requested-With, X-Profile-Contract, ngrok-skip-browser-warning',
    exposeHeaders: 'Retry-After',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
