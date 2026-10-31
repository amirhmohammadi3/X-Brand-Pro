import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import {
  LoginThrottleService,
  LOCKOUT_THRESHOLD,
} from '../src/modules/auth/login-throttle.service.js';
import { CsrfOriginGuard } from '../src/modules/auth/csrf-origin.guard.js';
import { AuthCookieService } from '../src/modules/auth/auth-cookie.service.js';
import { RateLimiterService } from '../src/redis/rate-limiter.service.js';
import { FakeRedis } from './fake-redis.js';

const CONFIG = {
  jwtAccessSecret: 'unit-test-access-secret-0123456789abcdef0123',
  jwtRefreshSecret: 'unit-test-refresh-secret-0123456789abcdef012',
  accessTtlSec: 900,
  refreshTtlDays: 30,
  refreshTtlSec: 30 * 86_400,
  cookieSecure: false,
  cookieDomain: undefined,
  publicWebUrl: 'http://localhost:3100',
} as const;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

describe('PasswordService (B1.3)', () => {
  const svc = new PasswordService();

  it('hashes with argon2id at the OWASP parameters and verifies', async () => {
    const hash = await svc.hash('Correct-Horse-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toMatch(/m=19456,p=1,t=2/);
    expect(await svc.verify(hash, 'Correct-Horse-1')).toBe(true);
    expect(await svc.verify(hash, 'wrong-password-1')).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehash', async () => {
    const weak = await svc.hash('weak-params-1');
    // Re-hash with a WEAKER timeCost to simulate an old hash.
    const { argon2id, hash } = await import('argon2');
    const oldHash = await hash('legacy-user-password-1', {
      type: argon2id,
      timeCost: 2,
      memoryCost: 4096,
      parallelism: 1,
    });
    expect(svc.needsRehash(oldHash)).toBe(true);
    expect(svc.needsRehash(weak)).toBe(false);
  });
});

describe('TokenService (B1.3)', () => {
  const svc = new TokenService(CONFIG as never);

  it('signs and verifies an access token round-trip', async () => {
    const token = await svc.signAccess({ sub: 'u-1', sid: 's-1', role: 'user' });
    const claims = await svc.verifyAccess(token);
    expect(claims).toMatchObject({ sub: 'u-1', sid: 's-1', role: 'user' });
    expect(claims?.jti).not.toBe('');
  });

  it('rejects a tampered signature and garbage tokens', async () => {
    const token = await svc.signAccess({ sub: 'u-1', sid: 's-1', role: 'user' });
    const tampered = `${token.slice(0, -6)}aaaaaa`;
    expect(await svc.verifyAccess(tampered)).toBeNull();
    expect(await svc.verifyAccess('not-a-jwt')).toBeNull();
  });

  it('expires the access token after ACCESS_TTL_SEC', async () => {
    const token = await svc.signAccess({ sub: 'u-1', sid: 's-1', role: 'user' });
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    expect(await svc.verifyAccess(token)).not.toBeNull();
    vi.setSystemTime(new Date('2026-11-01T10:15:01Z')); // > 900s later
    expect(await svc.verifyAccess(token)).toBeNull();
  });

  it('generates opaque refresh tokens and hashes them deterministically', () => {
    const a = svc.generateRefreshToken();
    const b = svc.generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(svc.hashRefresh(a)).toBe(svc.hashRefresh(a));
    expect(svc.hashRefresh(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('LoginThrottleService (B1.3)', () => {
  function make() {
    const redis = new FakeRedis();
    const limiter = new RateLimiterService(redis);
    const svc = new LoginThrottleService(limiter, redis);
    return { redis, svc };
  }

  it('locks after 5 consecutive failures and reports retryAfterSec', async () => {
    const { svc } = make();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await svc.recordFailure('user@x.ir');
    }
    await expect(svc.assertCanAttempt('1.2.3.4', 'user@x.ir')).rejects.toMatchObject({
      status: 429,
      response: { code: 'ACCOUNT_LOCKED' },
    });
  });

  it('recovers after the 15 minute window (fake clock)', async () => {
    const { svc } = make();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) await svc.recordFailure('locked@x.ir');
    await expect(svc.assertCanAttempt('1.2.3.4', 'locked@x.ir')).rejects.toThrow();
    vi.setSystemTime(new Date('2026-11-01T10:16:00Z')); // +16 min
    await expect(svc.assertCanAttempt('1.2.3.4', 'locked@x.ir')).resolves.toBeUndefined();
  });

  it('reset clears the failure counter (consecutive semantics)', async () => {
    const { svc } = make();
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i += 1) await svc.recordFailure('u2@x.ir');
    await svc.reset('u2@x.ir');
    await svc.recordFailure('u2@x.ir');
    await expect(svc.assertCanAttempt('1.2.3.4', 'u2@x.ir')).resolves.toBeUndefined();
  });

  it('rate limits 10 login attempts per 10 minutes per ip+identifier', async () => {
    const { svc } = make();
    for (let i = 0; i < 10; i += 1) {
      await expect(svc.assertCanAttempt('9.9.9.9', 'rl@x.ir')).resolves.toBeUndefined();
    }
    await expect(svc.assertCanAttempt('9.9.9.9', 'rl@x.ir')).rejects.toMatchObject({
      status: 429,
      response: { code: 'RATE_LIMITED' },
    });
    // A different identifier from the same ip is a different identity.
    await expect(svc.assertCanAttempt('9.9.9.9', 'other@x.ir')).resolves.toBeUndefined();
  });
});

describe('CsrfOriginGuard (B1.3)', () => {
  const guard = new CsrfOriginGuard(CONFIG as never);

  function ctx(method: string, headers: Record<string, string>, cookies?: Record<string, string>) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, headers, cookies }),
      }),
    } as never;
  }

  it('passes safe methods and requests without cookies', () => {
    expect(guard.canActivate(ctx('GET', {}))).toBe(true);
    expect(guard.canActivate(ctx('POST', {}))).toBe(true);
    expect(guard.canActivate(ctx('DELETE', { authorization: 'Bearer x' }))).toBe(true);
  });

  it('rejects cookie-bearing unsafe requests without an Origin', () => {
    expect(() => guard.canActivate(ctx('POST', { cookie: 'rt=abc' }))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('rejects a mismatching Origin and accepts the configured origin', () => {
    expect(() =>
      guard.canActivate(ctx('POST', { cookie: 'rt=abc', origin: 'https://evil.example' })),
    ).toThrow();
    expect(
      guard.canActivate(ctx('POST', { cookie: 'rt=abc', origin: 'http://localhost:3100' })),
    ).toBe(true);
    // Referer fallback works too.
    expect(
      guard.canActivate(ctx('PATCH', { cookie: 'rt=abc', referer: 'http://localhost:3100/page' })),
    ).toBe(true);
  });
});

describe('AuthCookieService (B1.3)', () => {
  it('sets both cookies httpOnly SameSite=Lax with TTL maxAge and clears them', () => {
    const svc = new AuthCookieService(CONFIG as never);
    const jar: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        jar.push({ name, value, options });
      },
      clearCookie(name: string, options: Record<string, unknown>) {
        jar.push({ name, value: '', options });
      },
    } as never;

    svc.set(res, { accessToken: 'AT', refreshToken: 'RT' });
    expect(jar).toHaveLength(2);
    const [at, rt] = jar;
    if (!at || !rt) throw new Error('cookies not set');
    expect(at.name).toBe('at');
    expect(at.value).toBe('AT');
    expect(at.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 900_000,
    });
    expect(rt.options).toMatchObject({ maxAge: 30 * 86_400_000, httpOnly: true });

    jar.length = 0;
    svc.clear(res);
    expect(jar.map((c) => c.name)).toEqual(['at', 'rt']);
  });
});

describe('AuthService.normalizeIdentifier (B1.3)', () => {
  it('normalizes Persian digits, case, whitespace and phone forms', async () => {
    const users = { getByIdentifier: vi.fn() } as unknown as never;
    const svc = new (await import('../src/modules/auth/auth.service.js')).AuthService(
      users,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      CONFIG as never,
      { emit: vi.fn() } as unknown as EventEmitter2,
    );
    expect(svc.normalizeIdentifier('  Amir  ')).toBe('amir');
    expect(svc.normalizeIdentifier('۰۹۱۲۳۴۵۶۷۸۹')).toBe('+989123456789');
    expect(svc.normalizeIdentifier('+98 912 345 6789')).toBe('+989123456789');
    expect(svc.normalizeIdentifier('00989123456789')).toBe('+989123456789');
    expect(svc.normalizeIdentifier('User@Example.COM')).toBe('user@example.com');
  });
});
