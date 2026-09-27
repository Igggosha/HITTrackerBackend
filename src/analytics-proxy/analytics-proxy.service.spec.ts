import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { validateAnalyticsProxyEnvironment } from '../config/environment';
import { AnalyticsProxyService } from './analytics-proxy.service';

type Seen = { url?: string; authorization?: string; requestId?: string };

function startUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    }),
  );
}

async function expectUnavailable(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  expect((error as ServiceUnavailableException).getResponse()).toEqual({
    message: 'Analytics service is unavailable',
    code: 'ANALYTICS_UNAVAILABLE',
  });
}

describe('AnalyticsProxyService', () => {
  const service = new AnalyticsProxyService();
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('forwards path, query, Authorization and X-Request-Id and returns the upstream response as-is', async () => {
    const seen: Seen = {};
    const upstream = await startUpstream((req, res) => {
      seen.url = req.url;
      seen.authorization = req.headers.authorization;
      seen.requestId = req.headers['x-request-id'] as string;
      res.writeHead(418, { 'content-type': 'application/json' });
      res.end('{"weeks":[]}');
    });
    try {
      process.env.ANALYTICS_URL = upstream.url;
      const result = await service.forward(
        '/analytics/me/weekly-volume?weeks=4',
        { authorization: 'Bearer abc', requestId: 'req-1' },
      );
      expect(seen).toEqual({
        url: '/analytics/me/weekly-volume?weeks=4',
        authorization: 'Bearer abc',
        requestId: 'req-1',
      });
      expect(result).toEqual({
        status: 418,
        contentType: 'application/json',
        body: '{"weeks":[]}',
      });
    } finally {
      await upstream.close();
    }
  });

  it('answers 503 ANALYTICS_UNAVAILABLE when ANALYTICS_URL is unset', async () => {
    delete process.env.ANALYTICS_URL;
    await expectUnavailable(service.forward('/analytics/me/summary', {}));
  });

  it('answers 503 ANALYTICS_UNAVAILABLE when the upstream does not answer in time', async () => {
    const upstream = await startUpstream(() => {
      /* never responds */
    });
    try {
      process.env.ANALYTICS_URL = upstream.url;
      process.env.ANALYTICS_TIMEOUT_MS = '150';
      const started = Date.now();
      await expectUnavailable(service.forward('/analytics/me/summary', {}));
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await upstream.close();
    }
  });

  it('answers 503 ANALYTICS_UNAVAILABLE when the upstream is down', async () => {
    const upstream = await startUpstream(() => undefined);
    const { url } = upstream;
    await upstream.close();
    process.env.ANALYTICS_URL = url;
    await expectUnavailable(service.forward('/analytics/me/summary', {}));
  });

  it('refuses paths that escape /analytics/', async () => {
    process.env.ANALYTICS_URL = 'http://analytics:3000';
    await expect(
      service.forward('/analytics/../metrics', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.forward('//evil.example/analytics/x', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates ANALYTICS_URL / ANALYTICS_TIMEOUT_MS at boot', () => {
    expect(() => validateAnalyticsProxyEnvironment({})).not.toThrow();
    expect(() =>
      validateAnalyticsProxyEnvironment({
        ANALYTICS_URL: 'http://analytics:3000',
      }),
    ).not.toThrow();
    expect(() =>
      validateAnalyticsProxyEnvironment({ ANALYTICS_URL: 'analytics:3000' }),
    ).toThrow('ANALYTICS_URL');
    expect(() =>
      validateAnalyticsProxyEnvironment({ ANALYTICS_URL: 'http://u:p@a:1' }),
    ).toThrow('ANALYTICS_URL');
    expect(() =>
      validateAnalyticsProxyEnvironment({ ANALYTICS_TIMEOUT_MS: '10' }),
    ).toThrow('ANALYTICS_TIMEOUT_MS');
  });
});
