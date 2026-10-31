import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RateLimit, RATE_LIMIT_KEY } from '../src/common/decorators/rate-limit.decorator.js';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard.js';
import { RateLimiterService } from '../src/redis/rate-limiter.service.js';
import { FakeRedis } from './fake-redis.js';

function fakeContext(req: { ip?: string; user?: { id: string } }, headers: Map<string, string>) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers.set(name, value);
        },
      }),
    }),
    getHandler: () => (): void => undefined,
    getClass: () => class Temporary {},
  } as unknown as ExecutionContext;
}

function makeGuard(): { guard: RateLimitGuard; reflector: Reflector; limiter: RateLimiterService } {
  const reflector = new Reflector();
  const limiter = new RateLimiterService(new FakeRedis());
  return { guard: new RateLimitGuard(reflector, limiter), reflector, limiter };
}

describe('RateLimitGuard (B0.3)', () => {
  it('passes routes without a @RateLimit spec and never touches the limiter', async () => {
    const { guard, reflector, limiter } = makeGuard();
    const spy = vi.spyOn(limiter, 'consume');
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const headers = new Map<string, string>();
    await expect(guard.canActivate(fakeContext({ ip: '1.1.1.1' }, headers))).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('consumes the limiter with an ip-scoped identity when allowed', async () => {
    const { guard, reflector, limiter } = makeGuard();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      name: 'search.suggest',
      limit: 10,
      windowSec: 60,
    });
    const consumeSpy = vi
      .spyOn(limiter, 'consume')
      .mockResolvedValue({
        allowed: true,
        limit: 10,
        remaining: 9,
        retryAfterSec: 0,
        degraded: false,
      });
    const headers = new Map<string, string>();
    await expect(guard.canActivate(fakeContext({ ip: '1.1.1.1' }, headers))).resolves.toBe(true);
    expect(consumeSpy).toHaveBeenCalledWith('search.suggest', 'ip:1.1.1.1', 10, 60);
    expect(headers.has('Retry-After')).toBe(false);
  });

  it('falls back from user scope to ip when the request is unauthenticated', async () => {
    const { guard, reflector, limiter } = makeGuard();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      name: 'auth.login',
      limit: 5,
      windowSec: 60,
      scope: 'user',
    });
    const consumeSpy = vi
      .spyOn(limiter, 'consume')
      .mockResolvedValue({
        allowed: true,
        limit: 5,
        remaining: 4,
        retryAfterSec: 0,
        degraded: false,
      });
    await guard.canActivate(fakeContext({ ip: '2.2.2.2' }, new Map()));
    expect(consumeSpy).toHaveBeenCalledWith('auth.login', 'ip:2.2.2.2', 5, 60);
  });

  it('uses the user id for user-scoped limits on authenticated requests', async () => {
    const { guard, reflector, limiter } = makeGuard();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      name: 'review.create',
      limit: 5,
      windowSec: 3600,
      scope: 'user',
    });
    const consumeSpy = vi
      .spyOn(limiter, 'consume')
      .mockResolvedValue({
        allowed: true,
        limit: 5,
        remaining: 4,
        retryAfterSec: 0,
        degraded: false,
      });
    await guard.canActivate(fakeContext({ ip: '2.2.2.2', user: { id: 'abc' } }, new Map()));
    expect(consumeSpy).toHaveBeenCalledWith('review.create', 'u:abc', 5, 3600);
  });

  it('throws a 429 RATE_LIMITED envelope and sets Retry-After when rejected', async () => {
    const { guard, reflector, limiter } = makeGuard();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      name: 'auth.login',
      limit: 1,
      windowSec: 60,
    });
    vi.spyOn(limiter, 'consume').mockResolvedValue({
      allowed: false,
      limit: 1,
      remaining: 0,
      retryAfterSec: 42,
      degraded: false,
    });
    const headers = new Map<string, string>();
    const err = await guard
      .canActivate(fakeContext({ ip: '3.3.3.3' }, headers))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    const httpException = err as HttpException;
    expect(httpException.getStatus()).toBe(429);
    const body = httpException.getResponse() as { code: string; message: string };
    expect(body.code).toBe('RATE_LIMITED');
    expect(headers.get('Retry-After')).toBe('42');
  });

  it('the @RateLimit decorator stores its spec under RATE_LIMIT_KEY', () => {
    class Sample {
      @RateLimit({ name: 'x.y', limit: 1, windowSec: 2 })
      handler(): void {
        return undefined;
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Sample.prototype, 'handler');
    expect(descriptor).toBeDefined();
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, descriptor?.value)).toEqual({
      name: 'x.y',
      limit: 1,
      windowSec: 2,
    });
  });
});
