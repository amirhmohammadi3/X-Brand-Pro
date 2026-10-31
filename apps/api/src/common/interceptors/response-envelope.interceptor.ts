import {
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';

/** Anything Reflector.get accepts as a metadata target (class or handler fn). */
type MetadataTarget = Parameters<Reflector['get']>[1];

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Marks a route handler as returning a raw (non-enveloped) response — used for
 * file streaming, ICS exports, health probes behind proxies, etc.
 */
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);

function isRaw(target: MetadataTarget, handler: MetadataTarget, reflector: Reflector): boolean {
  return (
    reflector.get<boolean>(RAW_RESPONSE_KEY, handler) === true ||
    reflector.get<boolean>(RAW_RESPONSE_KEY, target) === true
  );
}

type EnvelopedBody = { data?: unknown; meta?: unknown };

/**
 * Wraps every controller return value into the contracts success envelope:
 * `{ ok: true, data, meta? }`. Handlers may return `{ data, meta }` to attach
 * list meta, or any plain value (becomes `data`). Streams and routes marked
 * `@RawResponse()` pass through untouched.
 */
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    // Skip for streams (files, ICS, proxy pipes).
    const contentType = String(res.getHeader('content-type') ?? '');
    if (
      contentType.startsWith('application/octet-stream') ||
      contentType.startsWith('text/calendar') ||
      contentType.startsWith('image/') ||
      contentType.startsWith('video/')
    ) {
      return next.handle();
    }
    if (isRaw(ctx.getClass(), ctx.getHandler(), this.reflector)) return next.handle();

    return next.handle().pipe(
      map((body: unknown) => {
        if (
          body !== null &&
          typeof body === 'object' &&
          'data' in (body as EnvelopedBody) &&
          !('ok' in (body as Record<string, unknown>))
        ) {
          const { data, meta } = body as EnvelopedBody;
          return meta !== undefined ? { ok: true, data, meta } : { ok: true, data };
        }
        return { ok: true, data: body, requestId: req.id };
      }),
    );
  }
}
