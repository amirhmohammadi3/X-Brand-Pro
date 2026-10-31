import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit_spec';

export type RateLimitSpec = Readonly<{
  /** Stable limiter name, e.g. `auth.login` — becomes part of the Redis key. */
  name: string;
  /** Max requests allowed inside one window. */
  limit: number;
  /** Window length in seconds (fixed window). */
  windowSec: number;
  /**
   * Who the limit applies to. `ip` until the auth module lands; `user` will
   * fall back to ip while the request is unauthenticated.
   */
  scope?: 'ip' | 'user';
  /**
   * When true, a DEGRADED limiter (Redis unreachable) rejects with 503
   * instead of failing open — used on auth endpoints where abuse must not
   * slip through an outage (B1.3).
   */
  failClosed?: boolean;
}>;

/**
 * Opt-in rate limiting for a route (or controller): attach the spec, the
 * global RateLimitGuard picks it up. Example:
 * `@RateLimit({ name: 'auth.login', limit: 5, windowSec: 60 })`
 */
export const RateLimit = (spec: RateLimitSpec): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, spec);
