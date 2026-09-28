import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AnalyticsController } from '../src/analytics/analytics.controller';
import { AnalyticsQueryService } from '../src/analytics/analytics-query.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { requestIdMiddleware } from '../src/common/request-id';

const SECRET = 'test-secret-that-is-long-enough-123';

describe('Analytics read API (guard, DTO validation, error envelope)', () => {
  let app: INestApplication;
  const queries = {
    summary: jest.fn(() => ({ ok: true })),
    weeklyVolume: jest.fn(() => ({ weeks: [] })),
    personalRecords: jest.fn(() => ({ records: [] })),
    exerciseProgress: jest.fn(() => ({ points: [] })),
    bodyMetrics: jest.fn(() => ({ points: [] })),
  };
  const sign = (claims: object, options: object = {}, secret = SECRET) =>
    new JwtService().sign(claims, { secret, expiresIn: '5m', ...options });
  const token = () => sign({ sub: 7, email: 'a@b.c', role: 'user' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      controllers: [AnalyticsController],
      providers: [
        JwtAuthGuard,
        { provide: AnalyticsQueryService, useValue: queries },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestIdMiddleware);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('rejects a missing token with the standard envelope and request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/analytics/me/summary')
      .set('X-Request-Id', 'req-123')
      .expect(401);
    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
      requestId: 'req-123',
      path: '/analytics/me/summary',
    });
    expect(response.headers['x-request-id']).toBe('req-123');
    expect(queries.summary).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a wrong secret',
      () => sign({ sub: 7 }, {}, 'another-secret-another-secret-12'),
    ],
    ['an expired token', () => sign({ sub: 7 }, { expiresIn: -10 })],
    ['a token without a numeric sub', () => sign({ sub: 'x' })],
    ['a non-HS256 algorithm', () => sign({ sub: 7 }, { algorithm: 'HS512' })],
    ['garbage', () => 'not-a-jwt'],
  ])('rejects %s', async (_, make) => {
    await request(app.getHttpServer())
      .get('/analytics/me/summary')
      .set('Authorization', `Bearer ${make()}`)
      .expect(401);
  });

  it('answers for the JWT subject only', async () => {
    await request(app.getHttpServer())
      .get('/analytics/me/summary')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200, { ok: true });
    expect(queries.summary).toHaveBeenCalledWith(7, expect.any(Date));
  });

  it('defaults weeks to 12 and transforms it to a number', async () => {
    await request(app.getHttpServer())
      .get('/analytics/me/weekly-volume')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(queries.weeklyVolume).toHaveBeenCalledWith(7, 12, expect.any(Date));
    await request(app.getHttpServer())
      .get('/analytics/me/weekly-volume?weeks=4')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(queries.weeklyVolume).toHaveBeenLastCalledWith(
      7,
      4,
      expect.any(Date),
    );
  });

  it.each([
    '/analytics/me/weekly-volume?weeks=0',
    '/analytics/me/weekly-volume?weeks=105',
    '/analytics/me/weekly-volume?weeks=abc',
    '/analytics/me/body-metrics?from=yesterday',
    '/analytics/me/body-metrics?to=2026-13-01',
    '/analytics/me/exercises/abc/progress',
    '/analytics/me/exercises/1/progress?from=2026-02-30',
  ])('rejects invalid input: %s', async (url) => {
    const response = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
    });
    expect((response.body as { requestId?: unknown }).requestId).toEqual(
      expect.any(String),
    );
  });

  it('passes a valid date range and exercise id through', async () => {
    await request(app.getHttpServer())
      .get('/analytics/me/exercises/3/progress?from=2026-09-01&to=2026-09-30')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(queries.exerciseProgress).toHaveBeenCalledWith(7, 3, {
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});
