import { Module, INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { LoggerModule, Logger } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { requestIds } from '../src/common/request-id';
import { configureApp } from '../src/config/configure-app';
import { MetricsModule } from '../src/metrics/metrics.module';
import { MetricsService } from '../src/metrics/metrics.service';

// This app boots via the same `configureApp` that `main.ts` uses, so the
// request-id-first / helmet / body-parser / session middleware order it
// exercises is exactly production's order and cannot silently drift. It
// deliberately does not import `AppModule`: that module pulls in the real
// database pool, mailer, auth and every feature module, none of which this
// suite needs to reach a pre-routing body-parser failure. The session store
// created inside `configureApp` still needs a `DATABASE_URL` and
// `OAUTH_SESSION_SECRET` to construct without throwing, so both are stubbed
// below; neither is ever actually queried or read by the requests this file
// sends, since none of them carry a session cookie.
process.env.DATABASE_URL ??=
  'postgres://stub:stub@127.0.0.1:5432/stub_test_db';
process.env.OAUTH_SESSION_SECRET ??= 'e2e-bootstrap-order-test-secret';

@Module({
  controllers: [AppController],
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => (req as { id?: string }).id,
        mixin: () => ({ requestId: requestIds.getStore() ?? 'system' }),
        autoLogging: false,
      },
    }),
    // `configureApp` fetches `MetricsService` to wire up the metrics
    // middleware right after the request-id middleware; without this import
    // that `app.get(MetricsService)` call would throw.
    MetricsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
class BootstrapOrderTestModule {}

async function counterValue(
  metrics: MetricsService,
  labels: Record<string, string>,
): Promise<number> {
  const snapshot = await metrics.requests.get();
  return (
    snapshot.values.find((entry) =>
      Object.entries(labels).every(
        ([key, value]) => entry.labels[key] === value,
      ),
    )?.value ?? 0
  );
}

describe('bootstrap middleware order (e2e)', () => {
  let app: INestApplication<App>;
  let metrics: MetricsService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [BootstrapOrderTestModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useLogger(app.get(Logger));
    configureApp(app);
    await app.init();
    metrics = app.get(MetricsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives a normal route an X-Request-Id header', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('returns 413 PAYLOAD_TOO_LARGE for an oversized JSON body, with a matching request id', async () => {
    // Body-parser rejects this before Nest routing runs, so the failure
    // happens well before any controller/route is reached; the path just
    // needs to carry a JSON content type.
    const oversizedBody = JSON.stringify({ data: 'a'.repeat(200 * 1024) });

    const response = await request(app.getHttpServer())
      .post('/')
      .set('Content-Type', 'application/json')
      .send(oversizedBody)
      .expect(413);

    const headerRequestId = response.headers['x-request-id'];
    expect(headerRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(response.body).toMatchObject({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      requestId: headerRequestId,
    });

    // The metrics middleware sits ahead of the body parser (right after the
    // request-id middleware), so a failure the body parser raises before
    // Nest's router ever runs is still counted, unlike the old
    // APP_INTERCEPTOR-based recorder it replaced.
    expect(
      await counterValue(metrics, {
        method: 'POST',
        route: 'unmatched',
        status: '413',
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('labels an unknown path "unmatched" and still counts the 404', async () => {
    await request(app.getHttpServer()).get('/this-route-does-not-exist').expect(404);

    expect(
      await counterValue(metrics, {
        method: 'GET',
        route: 'unmatched',
        status: '404',
      }),
    ).toBe(1);
  });

  it('never records the /metrics scrape path itself', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(401);

    const snapshot = await metrics.requests.get();
    expect(snapshot.values.some((entry) => entry.labels.route === '/metrics')).toBe(
      false,
    );
  });

  it('returns 400 for malformed JSON, with a request id', async () => {
    const response = await request(app.getHttpServer())
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json')
      .expect(400);

    const headerRequestId = response.headers['x-request-id'];
    expect(headerRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(response.body).toMatchObject({
      statusCode: 400,
      requestId: headerRequestId,
    });
  });

  it('honours a client-supplied X-Request-Id even for a pre-routing failure', async () => {
    const oversizedBody = JSON.stringify({ data: 'a'.repeat(200 * 1024) });

    const response = await request(app.getHttpServer())
      .post('/')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'client_supplied_id')
      .send(oversizedBody)
      .expect(413);

    expect(response.headers['x-request-id']).toBe('client_supplied_id');
    expect(response.body.requestId).toBe('client_supplied_id');
  });
});
