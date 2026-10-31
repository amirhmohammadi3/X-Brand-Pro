import { describe, expect, it } from 'vitest';
import { RateLimiterService } from '../src/redis/rate-limiter.service.js';
import { FakeRedis } from './fake-redis.js';

describe('RateLimiterService (B0.3)', () => {
  const T0 = new Date('2026-10-31T12:00:00Z').getTime();
  let fake: FakeRedis;
  let limiter: RateLimiterService;

  const consume = (identity: string, now = T0) =>
    limiter.consume('auth.login', identity, 3, 60, now);

  it('allows requests up to the limit with a decreasing remaining count', async () => {
    fake = new FakeRedis();
    limiter = new RateLimiterService(fake);
    expect(await consume('1.2.3.4')).toMatchObject({ allowed: true, remaining: 2 });
    expect(await consume('1.2.3.4')).toMatchObject({ allowed: true, remaining: 1 });
    expect(await consume('1.2.3.4')).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('rejects after the limit and reports Retry-After inside the window', async () => {
    fake = new FakeRedis();
    limiter = new RateLimiterService(fake);
    for (let i = 0; i < 3; i += 1) await consume('1.2.3.4');
    const rejected = await consume('1.2.3.4');
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterSec).toBeGreaterThan(0);
    expect(rejected.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('resets the window after windowSec has passed (new epoch bucket)', async () => {
    fake = new FakeRedis();
    limiter = new RateLimiterService(fake);
    for (let i = 0; i < 4; i += 1) await consume('1.2.3.4'); // 3 allowed + 1 rejected
    const later = await consume('1.2.3.4', T0 + 61_000);
    expect(later.allowed).toBe(true);
    expect(later.remaining).toBe(2);
  });

  it('keeps identities and limiter names isolated', async () => {
    fake = new FakeRedis();
    limiter = new RateLimiterService(fake);
    for (let i = 0; i < 3; i += 1) await consume('1.2.3.4');
    expect((await consume('5.6.7.8')).allowed).toBe(true);
    expect((await limiter.consume('auth.otp', '1.2.3.4', 3, 60, T0)).allowed).toBe(true);
  });

  it('fails open when Redis is unreachable (degraded)', async () => {
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      del: async () => {
        throw new Error('down');
      },
      incr: async () => {
        throw new Error('down');
      },
      expire: async () => {
        throw new Error('down');
      },
      ttl: async () => {
        throw new Error('down');
      },
    };
    limiter = new RateLimiterService(broken);
    const result = await limiter.consume('auth.login', '1.2.3.4', 3, 60, T0);
    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
  });
});
