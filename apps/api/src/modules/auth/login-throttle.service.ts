import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
// RateLimiterService is constructor-injected (runtime type metadata): keep as
// a value import — consistent-type-imports would break DI here (see guard).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RateLimiterService } from '../../redis/rate-limiter.service.js';

/** Failure window + threshold for brute-force lockout (docs/SECURITY.md). */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_SEC = 15 * 60;

/**
 * Login throttling (B1.3), two layers on Redis:
 *
 * 1. Rate limit "10 per 10 minutes by ip+identifier" via the shared limiter.
 * 2. Brute-force lockout: 5 consecutive failures for the same normalized
 *    identifier within 15 minutes locks it for 15 minutes
 *    (`auth:fail:<sha256(identifier)>`), reset on success. The check runs
 *    BEFORE password verification.
 *
 * Failure mode: both layers fail OPEN on Redis outage (logged) — matching the
 * platform-wide limiter policy in docs/SECURITY.md.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(
    private readonly limiter: RateLimiterService,
    @Inject(REDIS) private readonly redis: RedisLike,
  ) {}

  private failKey(normalizedIdentifier: string): string {
    return `auth:fail:${createHash('sha256').update(normalizedIdentifier, 'utf8').digest('hex')}`;
  }

  /** Layer 1 + lockout pre-check. Throws 429 (RATE_LIMITED / ACCOUNT_LOCKED). */
  async assertCanAttempt(ip: string, normalizedIdentifier: string): Promise<void> {
    const identity = `ip:${ip}|id:${this.shortHash(normalizedIdentifier)}`;
    const result = await this.limiter.consume('auth.login', identity, 10, 10 * 60);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED' as const,
          message: 'Too many login attempts',
          details: { retryAfterSec: result.retryAfterSec },
        },
        result.degraded ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const count = await this.redis.get(this.failKey(normalizedIdentifier));
      if (count !== null && Number.parseInt(count, 10) >= LOCKOUT_THRESHOLD) {
        const ttl = await this.redis.ttl(this.failKey(normalizedIdentifier));
        const retryAfterSec = ttl > 0 ? ttl : LOCKOUT_WINDOW_SEC;
        throw new HttpException(
          {
            code: 'ACCOUNT_LOCKED' as const,
            message: 'Account temporarily locked due to failed attempts',
            details: { retryAfterSec },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `lockout check degraded (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Called after a failed password verification (or unknown identifier). */
  async recordFailure(normalizedIdentifier: string): Promise<void> {
    const key = this.failKey(normalizedIdentifier);
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, LOCKOUT_WINDOW_SEC, 'NX');
    } catch (err) {
      this.logger.warn(
        `lockout counter degraded (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Called after a successful login — the counter tracks CONSECUTIVE failures. */
  async reset(normalizedIdentifier: string): Promise<void> {
    try {
      await this.redis.del(this.failKey(normalizedIdentifier));
    } catch {
      // non-fatal
    }
  }

  private shortHash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
  }
}
