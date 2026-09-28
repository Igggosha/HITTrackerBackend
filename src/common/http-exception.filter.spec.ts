import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { HttpExceptionFilter } from './http-exception.filter';
import { requestIds } from './request-id';

describe('HttpExceptionFilter', () => {
  const logError = jest.fn();
  const logger = { error: logError } as unknown as PinoLogger;
  const filter = new HttpExceptionFilter(logger);

  function capture(exception: unknown) {
    let body: Record<string, unknown> = {};
    let status = 0;
    const headers = { 'Retry-After': '30' };
    const setHeader = jest.fn();
    const response = {
      status(value: number) {
        status = value;
        return {
          json(value: Record<string, unknown>) {
            body = value;
          },
        };
      },
      getHeader(name: keyof typeof headers) {
        return headers[name];
      },
      setHeader,
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'incoming_123',
          originalUrl: '/test?code=secret',
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return { body, status, response };
  }

  it.each([
    'STORAGE_UNAVAILABLE',
    'FILE_TOO_LARGE',
    'VERIFICATION_CODE_EXPIRED',
    'INVALID_CREDENTIALS',
  ])('preserves machine code %s and extra fields', (code) => {
    const { body, status } = capture(
      new HttpException(
        { code, details: [{ field: 'file' }], retryAfter: 30 },
        HttpStatus.BAD_REQUEST,
      ),
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code,
      details: [{ field: 'file' }],
      retryAfter: 30,
      requestId: 'incoming_123',
      path: '/test',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('keeps validation message arrays', () => {
    const { body } = capture(
      new BadRequestException(['name must be a string']),
    );
    expect(body.message).toEqual(['name must be a string']);
  });

  it('sanitizes unknown errors and logs them with the request ID', () => {
    const error = new Error('database password leaked');
    const { body, status } = capture(error);
    expect(status).toBe(500);
    expect(body).toMatchObject({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: 'incoming_123',
    });
    expect(JSON.stringify(body)).not.toContain('database password leaked');
    expect(logError).toHaveBeenCalledWith(
      { err: error, requestId: 'incoming_123' },
      'Unhandled request error',
    );
  });

  it('keeps throttler status and an existing Retry-After header', () => {
    const { body, status, response } = capture(
      new HttpException('Too Many Requests', 429),
    );
    expect(status).toBe(429);
    expect(body.message).toBe('Too Many Requests');
    expect(response.getHeader('Retry-After')).toBe('30');
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('keeps a body-parser PayloadTooLargeError as 413 with an exposed message', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { body, status } = capture(error);
    expect(status).toBe(413);
    expect(body).toMatchObject({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'request entity too large',
      requestId: 'incoming_123',
    });
    expect(logError).toHaveBeenCalledWith(
      { err: error, requestId: 'incoming_123' },
      'Unhandled request error',
    );
  });

  it('keeps a malformed-JSON SyntaxError as 400 with an exposed message', () => {
    const error = Object.assign(
      new SyntaxError("Unexpected token ' in JSON at position 0"),
      {
        status: 400,
        statusCode: 400,
        expose: true,
        type: 'entity.parse.failed',
      },
    );
    const { body, status } = capture(error);
    expect(status).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: "Unexpected token ' in JSON at position 0",
      requestId: 'incoming_123',
    });
  });

  it('falls back to the standard status text for a non-exposed library 4xx error', () => {
    const error = Object.assign(new Error('internal detail, do not leak'), {
      status: 415,
      statusCode: 415,
      expose: false,
    });
    const { body, status } = capture(error);
    expect(status).toBe(415);
    expect(body).toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'UNSUPPORTED MEDIA TYPE',
    });
    expect(JSON.stringify(body)).not.toContain('internal detail');
  });

  it('sanitizes a library error with a 5xx status instead of exposing it', () => {
    const error = Object.assign(new Error('upstream secret leaked'), {
      status: 502,
      statusCode: 502,
      expose: true,
    });
    const { body, status } = capture(error);
    expect(status).toBe(502);
    expect(body).toMatchObject({
      statusCode: 502,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body)).not.toContain('upstream secret leaked');
  });

  it('sanitizes an out-of-range numeric status as a plain 500', () => {
    const error = Object.assign(new Error('nonsense status'), {
      status: 999,
    });
    const { body, status } = capture(error);
    expect(status).toBe(500);
    expect(body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('falls back to the ALS request id when the request has none', () => {
    let body: Record<string, unknown> = {};
    const response = {
      status() {
        return {
          json(value: Record<string, unknown>) {
            body = value;
          },
        };
      },
      getHeader: () => undefined,
      setHeader: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: '/no-id' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    requestIds.run('als_store_id', () => {
      filter.catch(new Error('boom'), host);
    });

    expect(body.requestId).toBe('als_store_id');
  });
});
