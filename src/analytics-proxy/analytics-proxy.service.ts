import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const DEFAULT_ANALYTICS_TIMEOUT_MS = 3_000;

export type UpstreamResponse = {
  status: number;
  contentType: string;
  body: string;
};

/**
 * Forwards `GET /analytics/*` to the analytics service (the CQRS read side)
 * so the mobile app keeps a single base URL. No business logic: the caller's
 * access token and request id are passed through and the analytics service
 * verifies the token itself; its status and JSON body are returned as-is.
 */
@Injectable()
export class AnalyticsProxyService {
  private readonly logger = new Logger(AnalyticsProxyService.name);

  async forward(
    originalUrl: string,
    headers: { authorization?: string; requestId?: string },
  ): Promise<UpstreamResponse> {
    const base = process.env.ANALYTICS_URL;
    if (!base) throw this.unavailable();

    // Resolve like a browser would and refuse anything that escapes
    // /analytics/ (e.g. `/analytics/../metrics`) or leaves the upstream host.
    const origin = new URL(base);
    const target = new URL(originalUrl, origin);
    if (
      target.origin !== origin.origin ||
      !target.pathname.startsWith('/analytics/')
    )
      throw new NotFoundException();

    const timeoutMs = Number(
      process.env.ANALYTICS_TIMEOUT_MS ?? DEFAULT_ANALYTICS_TIMEOUT_MS,
    );
    try {
      const response = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          ...(headers.authorization && {
            authorization: headers.authorization,
          }),
          ...(headers.requestId && { 'x-request-id': headers.requestId }),
        },
        // Bounds the connection AND reading the body.
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        status: response.status,
        contentType:
          response.headers.get('content-type') ??
          'application/json; charset=utf-8',
        body: await response.text(),
      };
    } catch (error) {
      this.logger.warn(
        `analytics upstream unavailable: ${(error as { name?: string } | null)?.name ?? 'unknown'}`,
      );
      throw this.unavailable();
    }
  }

  private unavailable() {
    return new ServiceUnavailableException({
      message: 'Analytics service is unavailable',
      code: 'ANALYTICS_UNAVAILABLE',
    });
  }
}
