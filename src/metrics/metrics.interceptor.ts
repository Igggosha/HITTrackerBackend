import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

export function routeLabel(request: {
  route?: { path?: unknown };
  baseUrl?: string;
}): string | undefined {
  const route = request.route?.path;
  if (typeof route !== 'string') return undefined;
  return `${request.baseUrl ?? ''}${route}`.replace(/\/$/, '') || '/';
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const path = routeLabel(request);
    if (!path) return next.handle();
    if (path === '/metrics') return next.handle();

    const start = process.hrtime.bigint();
    const record = (status: number) => {
      const labels = {
        method: request.method,
        route: path,
        status: String(status),
      };
      this.metrics.requests.inc(labels);
      this.metrics.duration.observe(
        labels,
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    };
    return next.handle().pipe(
      tap({
        complete: () => record(response.statusCode),
        error: (error: { status?: number }) => record(error.status ?? 500),
      }),
    );
  }
}
