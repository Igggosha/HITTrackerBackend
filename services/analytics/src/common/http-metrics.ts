// EN: Records analytics HTTP volume and latency with bounded route labels after each response completes.
// UK: Записує кількість і затримку HTTP-запитів аналітики з обмеженими мітками маршрутів після завершення відповіді.

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
