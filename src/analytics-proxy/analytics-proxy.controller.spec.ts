import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtGuard } from '../auth/jwt.guard';
import { requestIdMiddleware } from '../common/request-id';
import { AnalyticsProxyController } from './analytics-proxy.controller';
import { AnalyticsProxyService } from './analytics-proxy.service';

describe('AnalyticsProxyController', () => {
  let app: INestApplication<App>;
  const proxy = { forward: jest.fn() };
  const guard = { canActivate: jest.fn(() => true) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnalyticsProxyController],
      providers: [{ provide: AnalyticsProxyService, useValue: proxy }],
    })
      .overrideGuard(JwtGuard)
      .useValue(guard)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestIdMiddleware);
    await app.init();
  });
  afterAll(() => app.close());

  it('forwards any GET below /analytics with the caller token and request id', async () => {
    proxy.forward.mockResolvedValue({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: '{"records":[]}',
    });
    const response = await request(app.getHttpServer())
      .get('/analytics/me/exercises/3/progress?from=2026-09-01')
      .set('Authorization', 'Bearer token')
      .set('X-Request-Id', 'req-42')
      .expect(200);
    expect(response.body).toEqual({ records: [] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(proxy.forward).toHaveBeenCalledWith(
      '/analytics/me/exercises/3/progress?from=2026-09-01',
      { authorization: 'Bearer token', requestId: 'req-42' },
    );
  });

  it('is protected by JwtGuard', async () => {
    guard.canActivate.mockReturnValueOnce(false);
    await request(app.getHttpServer()).get('/analytics/me/summary').expect(403);
  });
});
