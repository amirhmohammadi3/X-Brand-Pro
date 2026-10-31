import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS, type RedisLike } from './redis.client.js';

export type RateLimitResult = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets; 0 when unknown (degraded mode). */
  retryAfterSec: number;
  /** True when Redis was unreachable and the check was skipped (fail-open). */
  degraded: boolean;
}>;

/**
 * Fixed-window rate limiter on Redis.
 *
 * Algorithm: the counter key embeds the epoch window bucket
 * (`rl:<name>:<identity>:<bucket>`). Each check INCRs the counter and sets
 * its TTL with `EXPIRE NX` (atomic "only if no TTL" — Redis 7+), so the
 * counter and its lifetime are always paired and the window resets exactly
 * windowSec after the first hit in the bucket. Only a rejected check pays
 * the extra TTL round trip to compute Retry-After.
 *
 * Failure mode: FAIL OPEN. If Redis is unreachable the check is skipped and
 * logged — a limiter outage must not take the whole API down. Recorded in
 * docs/SECURITY.md.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(@Inject(REDIS) private readonly redis: RedisLike) {}

  async consume(
    name: string,
    identity: string,
    limit: number,
    windowSec: number,
    now: number = Date.now(),
  ): Promise<RateLimitResult> {
    const bucket = Math.floor(now / 1000 / windowSec);
    const key = `rl:${name}:${identity}:${bucket}`;
    try {
      const count = await this.redis.incr(key);
      await this.redis.expire(key, windowSec, 'NX');
      if (count <= limit) {
        return {
          allowed: true,
          limit,
          remaining: Math.max(0, limit - count),
          retryAfterSec: 0,
          degraded: false,
        };
      }
      const ttl = await this.redis.ttl(key);
      // ttl is -2 (missing) or -1 (no expiry) in edge cases — fall back to a
      // full window so the client still gets a sane Retry-After.
      const retryAfterSec = ttl > 0 ? ttl : windowSec;
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSec,
        degraded: false,
      };
    } catch (err) {
      this.logger.warn(
        `rate limiter degraded (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { allowed: true, limit, remaining: -1, retryAfterSec: 0, degraded: true };
    }
  }
}
