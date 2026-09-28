import {
  Controller,
  Get,
  INestApplication,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { JwtGuard } from '../src/auth/jwt.guard';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { configureApp } from '../src/config/configure-app';
import { MetricsModule } from '../src/metrics/metrics.module';
import { MetricsService } from '../src/metrics/metrics.service';

// Boots through the same `configureApp` production and
// test/bootstrap-order.e2e-spec.ts use, but adds a guarded route and a
// parameterised route on top of it: this suite is specifically about what
// the metrics middleware (src/metrics/metrics.middleware.ts) counts and how
// it labels routes, which the bootstrap-order suite does not exercise. The
// session store `configureApp` builds still needs a `DATABASE_URL` and
// `OAUTH_SESSION_SECRET` to construct without throwing, and `JwtStrategy`
// needs a `JWT_SECRET`; none of them are ever read, since no request here
// carries a session cookie or a real JWT.
process.env.DATABASE_URL ??= 'postgres://stub:stub@127.0.0.1:5432/stub_test_db';
process.env.OAUTH_SESSION_SECRET ??= 'metrics-middleware-test-secret';
process.env.JWT_SECRET ??= 'metrics-middleware-test-jwt-secret-value-24c';

@Controller('protected')
class ProtectedTestController {
  @Get()
  @UseGuards(JwtGuard)
  get() {
    return { ok: true };
  }
}

@Controller('items')
class ItemsTestController {
  @Get(':id')
  get(@Param('id') id: string) {
    return { id };
  }

  @Post(':id')
  post(@Param('id') id: string) {
    return { id };
  }
}

@Module({
  imports: [
    PassportModule,
    LoggerModule.forRoot({ pinoHttp: { autoLogging: false } }),
    MetricsModule,
  ],
  controllers: [AppController, ProtectedTestController, ItemsTestController],
  providers: [JwtStrategy],
})
class MetricsMiddlewareTestModule {}

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

describe('metrics middleware (e2e)', () => {
  let app: INestApplication<App>;
  let metrics: MetricsService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [MetricsMiddlewareTestModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    metrics = app.get(MetricsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts a guarded route hit without credentials as a 401, not a silent drop', async () => {
    // JwtGuard rejects before the controller method ever runs. An
    // interceptor-based recorder (the old MetricsInterceptor) never sees
    // this request at all, since interceptors only run once every guard has
    // already let the request through.
    await request(app.getHttpServer()).get('/protected').expect(401);

    expect(
      await counterValue(metrics, {
        method: 'GET',
        route: '/protected',
        status: '401',
      }),
    ).toBe(1);
  });

  it('counts an oversized body rejected by body-parser as a 413 labelled "unmatched"', async () => {
    const oversizedBody = JSON.stringify({ data: 'a'.repeat(200 * 1024) });

    await request(app.getHttpServer())
      .post('/items/123')
      .set('Content-Type', 'application/json')
      .send(oversizedBody)
      .expect(413);

    expect(
      await counterValue(metrics, {
        method: 'POST',
        route: 'unmatched',
        status: '413',
      }),
    ).toBe(1);
  });

  it('uses the route template, never the concrete id, for a parameterised route', async () => {
    await request(app.getHttpServer()).get('/items/123').expect(200);
    await request(app.getHttpServer()).get('/items/456').expect(200);

    expect(
      await counterValue(metrics, {
        method: 'GET',
        route: '/items/:id',
        status: '200',
      }),
    ).toBe(2);

    // Neither concrete id ever shows up as its own route label.
    const snapshot = await metrics.requests.get();
    expect(
      snapshot.values.some(
        (entry) =>
          entry.labels.route === '/items/123' ||
          entry.labels.route === '/items/456',
      ),
    ).toBe(false);
  });

  it('labels an unknown path "unmatched" on a 404', async () => {
    await request(app.getHttpServer()).get('/does-not-exist').expect(404);

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
    expect(
      snapshot.values.some((entry) => entry.labels.route === '/metrics'),
    ).toBe(false);
  });
});
