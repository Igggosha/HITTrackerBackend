import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { HttpExceptionFilter } from './http-exception.filter';

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
});
