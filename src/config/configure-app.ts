import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { Express } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { isCorsOriginAllowed } from './cors';
import { configureTrustProxy } from './trust-proxy';
import { pool } from '../db/db';
import { createValidationPipe } from '../users/body-metrics-validation';
import { requestIdMiddleware } from '../common/request-id';
import { createMetricsMiddleware } from '../metrics/metrics.middleware';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Applies every request-handling middleware/pipe the API needs, in the exact
 * order production requires. `main.ts` and the bootstrap-order e2e test both
 * call this function so the tested order can never drift from the real one.
 *
 * The request-id middleware must be the very first `app.use(...)` call: Nest
 * only wires up module-bound middleware (see `AppModule`) once the app is
 * initialised, which is after every `app.use(...)` made here. Registering it
 * here, first, guarantees a request id (and the matching `X-Request-Id`
 * response header) even for requests that fail in helmet or the body
 * parsers, before any routing happens.
 *
 * The metrics middleware is registered immediately after it, still ahead of
 * helmet and the body parsers, so a request that never reaches Nest's guards
 * or router — rejected by helmet, an oversized/malformed body, an unmatched
 * path — is still counted (see `src/metrics/metrics.middleware.ts`).
 */
export function configureApp(app: INestApplication): void {
  app.use(requestIdMiddleware);
  app.use(createMetricsMiddleware(app.get(MetricsService)));

  // Cloudflare Tunnel is the only public hop; secure OAuth cookies need its HTTPS signal.
  configureTrustProxy(
    app.getHttpAdapter().getInstance() as Express,
    process.env.NODE_ENV === 'production',
  );
  app.useGlobalPipes(
    createValidationPipe({ transform: true, whitelist: true }),
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
      'Content-Type, Accept, Authorization, X-Requested-With, X-Profile-Contract, X-Request-Id, ngrok-skip-browser-warning',
    exposeHeaders: 'Retry-After, X-Request-Id, X-Trace-Id',
    credentials: true,
  });
}
