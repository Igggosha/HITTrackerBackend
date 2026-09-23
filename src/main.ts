import { ValidationPipe } from '@nestjs/common';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Cloudflare Tunnel is the only public hop; secure OAuth cookies need its HTTPS signal.
  configureTrustProxy(
    app.getHttpAdapter().getInstance() as Express,
    process.env.NODE_ENV === 'production',
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
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
