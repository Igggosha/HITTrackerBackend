import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Response } from 'express';
import type { RequestWithId } from './request-id';
import { requestIds } from './request-id';

/**
 * Errors thrown by express body-parser/raw-body/http-errors (oversized JSON,
 * unsupported charset, malformed body, ...) never reach Nest's routing layer,
 * so they are never a `HttpException`. They do carry a numeric `status`/
 * `statusCode` though, and `http-errors` marks whether the message is safe to
 * show a client via `expose`. Recover that instead of collapsing everything
 * that isn't a `HttpException` into a plain 500.
 */
function extractLibraryStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const candidate =
    (exception as { status?: unknown }).status ??
    (exception as { statusCode?: unknown }).statusCode;
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 400 &&
    candidate <= 599
    ? candidate
    : undefined;
}

function isExposedLibraryError(exception: unknown): exception is Error {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { expose?: unknown }).expose === true &&
    exception instanceof Error
  );
}

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const libraryStatus = isHttp ? undefined : extractLibraryStatus(exception);
    // A library status in 400-599 is trusted as-is; a plain 4xx from
    // body-parser/http-errors is a client error, so keep its real status
    // instead of forcing 500. A library 5xx is still sanitized below.
    const isClientLibraryError =
      libraryStatus !== undefined && libraryStatus < 500;
    const status = isHttp
      ? exception.getStatus()
      : (libraryStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = isHttp ? exception.getResponse() : undefined;
    const fields =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};
    const requestId = request.id ?? requestIds.getStore() ?? 'unknown';
    const statusText = HttpStatus[status]?.replaceAll('_', ' ') ?? 'Error';

    if (!isHttp) {
      this.logger.error(
        { err: exception, requestId },
        'Unhandled request error',
      );
    }

    response.status(status).json({
      ...fields,
      statusCode: status,
      error: 'error' in fields ? fields.error : statusText,
      message:
        'message' in fields
          ? fields.message
          : typeof payload === 'string'
            ? payload
            : isHttp
              ? exception.message
              : isClientLibraryError
                ? isExposedLibraryError(exception)
                  ? exception.message
                  : statusText
                : 'Internal server error',
      ...(!isHttp && {
        code: isClientLibraryError
          ? (HttpStatus[status] ?? 'HTTP_ERROR')
          : 'INTERNAL_ERROR',
      }),
      requestId,
      timestamp: new Date().toISOString(),
      path: (request.originalUrl ?? request.url).split('?')[0],
    });
  }
}
