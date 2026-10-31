import { type CanActivate, type ExecutionContext, HttpException, Injectable } from '@nestjs/common';
// Reflector and RateLimiterService are constructor-injected classes: Nest reads
// their types from emitDecoratorMetadata at RUNTIME, so they must stay value
// imports (consistent-type-imports would break DI if applied — do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { type RateLimitSpec, RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RateLimiterService } from '../../redis/rate-limiter.service.js';

interface RateLimitedRequest extends Request {
  /** Set by the auth module in later prompts; absent until then. */
  user?: { id: string };
}

/**
 * Global guard (registered via APP_GUARD in AppModule) that applies
 * `@RateLimit` specs using the Redis limiter. Routes without the decorator
 * pass through untouched — the health endpoint, for example, never touches
 * Redis. On rejection the response carries `Retry-After` and the standard
 * error envelope (code RATE_LIMITED, HTTP 429).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<RateLimitSpec>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!spec) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<RateLimitedRequest>();
    const res = http.getResponse<Response>();

    const scope = spec.scope ?? 'ip';
    const identity =
      scope === 'user' && req.user?.id ? `u:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;

    const result = await this.limiter.consume(spec.name, identity, spec.limit, spec.windowSec);
    if (result.allowed) return true;

    if (result.degraded && spec.failClosed) {
      // Auth endpoints opt into failing closed: an outage must not become an
      // open door. 503 SERVICE_UNAVAILABLE (not 429 — nothing was "too many").
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE' as const,
          message: 'Rate limiter unavailable',
        },
        503,
      );
    }

    if (result.retryAfterSec > 0) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
    }
    throw new HttpException(
      {
        code: 'RATE_LIMITED' as const,
        message: 'Too many requests',
        details: { limit: result.limit, windowSec: spec.windowSec, scope },
      },
      429,
    );
  }
}
