import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { createMetricsMiddleware, routeLabel } from './metrics.middleware';
import { MetricsService } from './metrics.service';

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', path: '/workouts', ...overrides } as Request;
}

function fakeResponse(statusCode: number): Response & EventEmitter {
  const response = new EventEmitter() as Response & EventEmitter;
  (response as unknown as { statusCode: number }).statusCode = statusCode;
  return response;
}

describe('routeLabel', () => {
  it('uses the Nest route template and never a concrete request URL', () => {
    expect(
      routeLabel({ baseUrl: '/workouts', route: { path: '/history/:id' } }),
    ).toBe('/workouts/history/:id');
  });

  it('labels a request without a matched route "unmatched"', () => {
    expect(routeLabel({ baseUrl: '/users' })).toBe('unmatched');
  });

  it('labels Express/Nest\'s internal not-found splat route "unmatched", not its literal pattern', () => {
    // Express 5 (via Nest's ExpressAdapter) routes an unmatched request
    // through its own catch-all splat route rather than leaving `req.route`
    // unset; `req.route.path` comes back as the literal `/{*path}` for every
    // 404, regardless of the request path. It must still read as "unmatched".
    expect(routeLabel({ baseUrl: '', route: { path: '/{*path}' } })).toBe(
      'unmatched',
    );
  });
});

describe('metrics middleware', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('records the request on finish with the matched route, method, and status', async () => {
    const middleware = createMetricsMiddleware(metrics);
    const request = fakeRequest({ baseUrl: '', route: { path: '/' } });
    const response = fakeResponse(200);
    const next = jest.fn();

    middleware(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);

    response.emit('finish');

    const snapshot = await metrics.requests.get();
    expect(snapshot.values).toContainEqual(
      expect.objectContaining({
        labels: { method: 'GET', route: '/', status: '200' },
        value: 1,
      }),
    );
  });

  it('labels a 404 for an unmatched path "unmatched"', async () => {
    const middleware = createMetricsMiddleware(metrics);
    const request = fakeRequest({ method: 'POST', path: '/nope' });
    const response = fakeResponse(404);

    middleware(request, response, jest.fn());
    response.emit('finish');

    const snapshot = await metrics.requests.get();
    expect(snapshot.values).toContainEqual(
      expect.objectContaining({
        labels: { method: 'POST', route: 'unmatched', status: '404' },
        value: 1,
      }),
    );
  });

  it('counts an aborted request once on close without a finish event', async () => {
    const middleware = createMetricsMiddleware(metrics);
    const request = fakeRequest();
    const response = fakeResponse(200);

    middleware(request, response, jest.fn());
    response.emit('close');

    const requestSnapshot = await metrics.requests.get();
    expect(requestSnapshot.values).toHaveLength(0);

    const abortedSnapshot = await metrics.aborted.get();
    expect(abortedSnapshot.values).toContainEqual(
      expect.objectContaining({
        labels: { method: 'GET', route: 'unmatched' },
        value: 1,
      }),
    );
  });

  it('does not double-count as aborted when close fires after finish', async () => {
    const middleware = createMetricsMiddleware(metrics);
    const request = fakeRequest({ route: { path: '/' } });
    const response = fakeResponse(200);

    middleware(request, response, jest.fn());
    response.emit('finish');
    response.emit('close');

    const abortedSnapshot = await metrics.aborted.get();
    expect(abortedSnapshot.values.every((entry) => entry.value === 0)).toBe(
      true,
    );
  });

  it('excludes the /metrics scrape path from recording entirely', async () => {
    const middleware = createMetricsMiddleware(metrics);
    const request = fakeRequest({ path: '/metrics' });
    const response = fakeResponse(200);

    middleware(request, response, jest.fn());
    response.emit('finish');
    response.emit('close');

    const requestSnapshot = await metrics.requests.get();
    expect(requestSnapshot.values).toHaveLength(0);
    const abortedSnapshot = await metrics.aborted.get();
    expect(abortedSnapshot.values).toHaveLength(0);
  });
});
