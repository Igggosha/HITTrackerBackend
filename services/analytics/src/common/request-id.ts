import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestIds } from './log-context';

export type RequestWithId = Request & { id: string };

/**
 * Same contract as the main API: a well-formed incoming `X-Request-Id` (the
 * main API's proxy forwards its own) is kept, otherwise a new UUID is used;
 * it is echoed in the response header, every log line and error envelopes.
 */
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
