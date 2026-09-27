import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

const METRICS_SCRAPE_PATH = '/metrics';

// Express 5 (via Nest's ExpressAdapter) serves an unmatched request through
// its own internal catch-all splat route — `req.route.path` is set to a
// literal `/{*path}` rather than being left unset. It is not a real,
// bounded-cardinality application route (it never varies with the request),
// so it is normalized to "unmatched" like a request that never got a
// `req.route` at all.
const NOT_FOUND_WILDCARD_ROUTE = /\{\*[^}]*\}/;

/**
 * The Express route template for a matched request (`req.baseUrl` plus
 * `req.route.path`, e.g. `/workouts/history/:id`), `"unmatched"` for a
 * request no application route ever claimed (a 404, or one rejected by
 * helmet/the body parsers before Nest's router runs), and never the raw
 * request URL/query: those carry unbounded cardinality (ids, tokens,
 * filenames, ...) that would blow up Prometheus label sets.
 */
export function routeLabel(request: {
  route?: { path?: unknown };
  baseUrl?: string;
}): string {
  const route = request.route?.path;
  if (typeof route !== 'string' || NOT_FOUND_WILDCARD_ROUTE.test(route))
    return 'unmatched';
  return `${request.baseUrl ?? ''}${route}`.replace(/\/$/, '') || '/';
}

/**
 * Records HTTP request volume/latency as plain middleware rather than a Nest
 * `APP_INTERCEPTOR`. Interceptors only run for a request that reaches a
 * matched controller handler *after* every guard has allowed it through, so
 * an interceptor-based recorder silently drops every guard rejection
 * (401/403), throttling (429), unmatched route (404), and pre-routing
 * body-parser failure (400/413) — exactly the failures worth alerting on.
 *
 * `configureApp` registers this immediately after the request-id middleware
 * and before helmet/the body parsers, so it wraps the entire request
 * lifecycle. The route label is only read once the response is finishing
 * (`res.on('finish')`)/closing (`res.on('close')`), by which point Express
 * has already attached `req.route`/`req.baseUrl` for a matched route (guards
 * run inside the matched route's handler layer, so `req.route` is set before
 * a guard can reject a request) or left them unset for one that never
 * matched.
 *
 * A response that closes without ever finishing (the client disconnected,
 * or the connection was reset mid-response) is counted separately via
 * `http_requests_aborted_total` instead of guessing a status code for it.
 */
export function createMetricsMiddleware(metrics: MetricsService) {
  return function metricsMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    // Never measure the scrape endpoint itself: every scrape (every 15s, see
    // docker/observability/prometheus/prometheus.yml) would otherwise dwarf
    // real traffic in `http_requests_total`.
    if (request.path === METRICS_SCRAPE_PATH) {
      next();
      return;
    }

    const start = process.hrtime.bigint();
    let finished = false;

    response.on('finish', () => {
      finished = true;
      const labels = {
        method: request.method,
        route: routeLabel(request),
        status: String(response.statusCode),
      };
      metrics.requests.inc(labels);
      metrics.duration.observe(
        labels,
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    });

    response.on('close', () => {
      if (finished) return;
      metrics.aborted.inc({
        method: request.method,
        route: routeLabel(request),
      });
    });

    next();
  };
}
