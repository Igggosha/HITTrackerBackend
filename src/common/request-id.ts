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
  // Idempotent so binding this middleware twice (e.g. once as the first
  // `app.use` in bootstrap and once more through a module) can never
  // reassign the id mid-request: a second pass would otherwise regenerate a
  // random id (the incoming header is unchanged, but nothing marks the
  // request as already assigned) and desync it from the id already logged
  // and sent as the `X-Request-Id` response header.
  const existing = (req as Partial<RequestWithId>).id;
  if (existing) {
    if (requestIds.getStore() === existing) {
      next();
    } else {
      requestIds.run(existing, next);
    }
    return;
  }

  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(incoming)
      ? incoming
      : randomUUID();
  (req as RequestWithId).id = id;
  res.setHeader('X-Request-Id', id);
  requestIds.run(id, next);
}
