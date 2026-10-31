import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sets `req.id` from the incoming X-Request-Id header (when it is a valid
 * uuid) or generates one, and echoes it on the response as X-Request-Id.
 * Must run before everything else (registered first in configureApp).
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && UUID_RE.test(incoming) ? incoming : randomUUID();
  // Plain assignment (writable) so pino-http's loggingMiddleware can also
  // assign req.id later without throwing on a read-only property.
  (req as Request & { id: string }).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
