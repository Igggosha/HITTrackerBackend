import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { requestIdMiddleware, requestIds } from './request-id';

describe('requestIdMiddleware', () => {
  it('adds the header to a real HTTP response', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/', (_req, res) => res.sendStatus(204));
    const response = await request(app)
      .get('/')
      .set('X-Request-Id', 'from_client')
      .expect(204);
    expect(response.headers['x-request-id']).toBe('from_client');
  });

  it.each(['safe_123-Id', 'bad.id', 'x'.repeat(65)])(
    'returns a safe X-Request-Id for %s',
    (incoming) => {
      const req = {
        headers: { 'x-request-id': incoming },
      } as unknown as Request;
      const setHeader = jest.fn();
      const res = { setHeader } as unknown as Response;
      const next = jest.fn(() => {
        expect(requestIds.getStore()).toBe(
          (req as Request & { id: string }).id,
        );
      }) as NextFunction;
      requestIdMiddleware(req, res, next);
      const id = (req as Request & { id: string }).id;
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(id === incoming).toBe(incoming === 'safe_123-Id');
      expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
      expect(next).toHaveBeenCalled();
    },
  );

  it('is idempotent when bound twice: a second pass keeps the same id', () => {
    const req = { headers: {} } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;

    requestIdMiddleware(req, res, () => {
      const firstId = (req as Request & { id: string }).id;
      expect(setHeader).toHaveBeenCalledTimes(1);

      requestIdMiddleware(req, res, () => {
        expect(requestIds.getStore()).toBe(firstId);
      });

      expect((req as Request & { id: string }).id).toBe(firstId);
      // The header must not be reassigned to a different, second id.
      expect(setHeader).toHaveBeenCalledTimes(1);
    });
  });
});
