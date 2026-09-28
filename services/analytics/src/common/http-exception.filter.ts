import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { requestIds } from './log-context';
import type { RequestWithId } from './request-id';

/**
 * The main API's error envelope:
 * `{ statusCode, error, message, code?, requestId, timestamp, path }`.
 * Unexpected errors become a generic 500 and are logged, never echoed.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : undefined;
    const fields =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const requestId = request.id ?? requestIds.getStore() ?? 'unknown';
    if (!isHttp)
      this.logger.error({
        msg: 'Unhandled request error',
        error: exception instanceof Error ? exception.name : 'unknown',
        requestId,
      });

    response.status(status).json({
      ...fields,
      statusCode: status,
      error:
        'error' in fields
          ? fields.error
          : (HttpStatus[status]?.replaceAll('_', ' ') ?? 'Error'),
      message:
        'message' in fields
          ? fields.message
          : typeof payload === 'string'
            ? payload
            : isHttp
              ? exception.message
              : 'Internal server error',
      ...(!isHttp && { code: 'INTERNAL_ERROR' }),
      requestId,
      timestamp: new Date().toISOString(),
      path: (request.originalUrl ?? request.url).split('?')[0],
    });
  }
}
