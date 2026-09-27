import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

export type RequestWithId = Request & { id: string };
export const requestIds = new AsyncLocalStorage<string>();

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(incoming)
      ? incoming
      : randomUUID();
  (req as RequestWithId).id = id;
  res.setHeader('X-Request-Id', id);
  requestIds.run(id, next);
}
