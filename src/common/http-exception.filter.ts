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

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

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
        ? payload
        : {};

    if (!isHttp) {
      this.logger.error(
        { err: exception, requestId: request.id },
        'Unhandled request error',
      );
    }

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
      requestId: request.id,
      timestamp: new Date().toISOString(),
      path: (request.originalUrl ?? request.url).split('?')[0],
    });
  }
}
