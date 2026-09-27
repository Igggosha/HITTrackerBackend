import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from '../metrics/metrics.service';

/** Counts requests by Nest route template (never the raw URL / ids). */
export default function httpMetrics(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      const route =
        (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
      metrics.httpRequests.inc({
        method: req.method,
        route: `${req.baseUrl ?? ''}${route}`,
        status: String(res.statusCode),
      });
    });
    next();
  };
}
