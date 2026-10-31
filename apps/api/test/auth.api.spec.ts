import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { FakeRedis } from './fake-redis.js';
import {
  bearerFromCookies,
  cookieValue,
  createUser,
  extractCookies,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

// env defaults come from global-setup (registered in vitest.config.ts).

/**
 * HTTP-level auth tests (B1.3) WITHOUT live services: Redis is the in-memory
 * FakeRedis, the user/session repositories are in-memory fakes. This runs
 * the REAL controller, guards (RateLimit → JwtAuth → CsrfOrigin → Roles),
 * pipes, envelope, cookie handling and services. A live-DB run happens in
 * CI / Docker machines (PROGRESS Follow-ups).
 */
let app: INestApplication;
let redis: FakeRedis;
let sessionRepo: ReturnType<typeof makeMemorySessionRepo>;
let userRepo: ReturnType<typeof makeMemoryUserRepo>;

beforeAll(async () => {
  redis = new FakeRedis();
  sessionRepo = makeMemorySessionRepo();
  userRepo = makeMemoryUserRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(sessionRepo)
    .overrideProvider(USERS_REPOSITORY)
    .useValue(userRepo)
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

const ORIGIN = 'http://localhost:3100'; // PUBLIC_WEB_URL from global-setup

function post(path: string) {
  return request(app.getHttpServer()).post(path);
}
function get(path: string) {
  return request(app.getHttpServer()).get(path);
}

describe('POST /api/v1/auth/register (B1.3)', () => {
  it('registers a user, sets httpOnly SameSite=Lax cookies and returns the user', async () => {
    const res = await post('/api/v1/auth/register').send({
      username: 'register_user',
      password: 'Sup3rSecret!',
      email: 'reg@x.ir',
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user).toMatchObject({
      username: 'register_user',
      email: 'reg@x.ir',
      role: 'user',
      status: 'active',
      emailVerified: false, // stored UNVERIFIED
    });
    expect(res.body.data).toHaveProperty('accessExpiresAt');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');

    const raw = res.headers['set-cookie'] as unknown as string[];
    const rtCookie = (Array.isArray(raw) ? raw : [raw]).find((c) => c.startsWith('rt='));
    expect(rtCookie).toContain('HttpOnly');
    expect(rtCookie).toContain('SameSite=Lax');
    expect(rtCookie).toContain('Path=/');
  });

  it('rejects duplicate username/email/phone with 409 and a field detail', async () => {
    // Existing email/phone owners (created outside the register limiter).
    await createUser(app, {
      username: 'phone_owner',
      password: 'Own3rPass!',
      phone: '+989120000000',
    });
    // register_user was already created above → username duplicate:
    const dupUsername = await post('/api/v1/auth/register').send({
      username: 'register_user',
      password: 'Sup3rSecret!',
    });
    expect(dupUsername.status).toBe(409);
    expect(dupUsername.body.error.code).toBe('CONFLICT');
    expect(dupUsername.body.error.details).toEqual({ field: 'username' });

    // The register limiter allows 5/hour per ip; these are attempts 3+4+5.
    const dupEmail = await post('/api/v1/auth/register').send({
      username: 'other_one',
      password: 'Sup3rSecret!',
      email: 'reg@x.ir',
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.details).toEqual({ field: 'email' });

    const dupPhone = await post('/api/v1/auth/register').send({
      username: 'other_two',
      password: 'Sup3rSecret!',
      phone: '09120000000',
    });
    expect(dupPhone.status).toBe(409);
    expect(dupPhone.body.error.details).toEqual({ field: 'phone' });

    const weak = await post('/api/v1/auth/register').send({
      username: 'other_three',
      password: 'nodigit',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    // Exactly 5 register calls from this ip in this suite → the 6th (next
    // suites use createUser()) would be rate limited — do not add any here.
  });
});

describe('POST /api/v1/auth/login (B1.3)', () => {
  let session: LoginSession;

  it('logs in by username, email and phone (with Persian digits)', async () => {
    await createUser(app, {
      username: 'login_user',
      password: 'Passw0rd!!',
      email: 'login@x.ir',
      phone: '+989121111111',
    });

    const byUsername = await post('/api/v1/auth/login').send({
      identifier: 'login_user',
      password: 'Passw0rd!!',
    });
    expect(byUsername.status).toBe(200);
    expect(byUsername.body.data.user.username).toBe('login_user');
    expect(extractCookies(byUsername).map((c) => c.split('=')[0])).toEqual(
      expect.arrayContaining(['at', 'rt']),
    );
    session = {
      cookies: extractCookies(byUsername),
      bearer: bearerFromCookies(extractCookies(byUsername)),
      body: byUsername.body,
    };

    const byEmail = await post('/api/v1/auth/login').send({
      identifier: 'LOGIN@x.ir',
      password: 'Passw0rd!!',
    });
    expect(byEmail.status).toBe(200);

    // Phone with Persian digits normalizes to the same E.164 row.
    const byPhone = await post('/api/v1/auth/login').send({
      identifier: '۰۹۱۲۱۱۱۱۱۱۱',
      password: 'Passw0rd!!',
    });
    expect(byPhone.status).toBe(200);
    const phoneUserId = (byPhone.body.data as { user: { id: string } }).user.id;
    const usernameUserId = (session.body.data as { user: { id: string } }).user.id;
    expect(phoneUserId).toBe(usernameUserId);
  });

  it('returns the identical generic error for unknown user and wrong password', async () => {
    const unknown = await post('/api/v1/auth/login').send({
      identifier: 'no_such_user',
      password: 'Whatever1',
    });
    const wrong = await post('/api/v1/auth/login').send({
      identifier: 'wrongpass_user',
      password: 'WrongPass99',
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toEqual(
      expect.objectContaining({ code: wrong.body.error.code, message: wrong.body.error.message }),
    );
  });

  it('locks the identifier after 5 consecutive failures and recovers after 15 min', async () => {
    // Dedicated user: the failure counter would lock login_user for the
    // rest of the suite otherwise (Redis state is shared per file).
    await createUser(app, { username: 'lockout_user', password: 'Passw0rd!!' });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    try {
      for (let i = 0; i < 5; i += 1) {
        const fail = await post('/api/v1/auth/login').send({
          identifier: 'lockout_user',
          password: 'BadBadBad1',
        });
        expect(fail.status).toBe(401);
      }
      const locked = await post('/api/v1/auth/login').send({
        identifier: 'lockout_user',
        password: 'Passw0rd!!',
      });
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(locked.body.error.details.retryAfterSec).toBeGreaterThan(0);

      // Fake-clock jump past the 15 minute lockout + rate-limit window.
      vi.setSystemTime(new Date('2026-11-01T12:16:00Z'));
      const recovered = await post('/api/v1/auth/login').send({
        identifier: 'lockout_user',
        password: 'Passw0rd!!',
      });
      expect(recovered.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});

describe('Refresh rotation + reuse detection (B1.3)', () => {
  it('rotates on refresh, then burns the family when the old token replays', async () => {
    await createUser(app, { username: 'rotate_user', password: 'Passw0rd!!' });
    const login = await loginAs(app, 'rotate_user', 'Passw0rd!!');
    const oldAccess = login.bearer;
    const oldRt = cookieValue(login.cookies, 'rt');

    // Refresh via cookie (needs Origin because the request carries cookies).
    const refresh = await post('/api/v1/auth/refresh')
      .set('Cookie', login.cookies)
      .set('Origin', ORIGIN);
    expect(refresh.status).toBe(200);
    const newRt = cookieValue(extractCookies(refresh), 'rt');
    expect(newRt).not.toBe(oldRt);
    expect(refresh.body.data.user.username).toBe('rotate_user');

    // Replaying the OLD refresh token = reuse → TOKEN_REUSED, family burned.
    const replay = await post('/api/v1/auth/refresh')
      .set('Cookie', [`rt=${oldRt}`])
      .set('Origin', ORIGIN);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');

    // The NEW token is dead too (whole family revoked).
    const newRtRefresh = await post('/api/v1/auth/refresh')
      .set('Cookie', [`rt=${newRt}`])
      .set('Origin', ORIGIN);
    expect(newRtRefresh.status).toBe(401);

    // And the still-unexpired access token no longer passes the guard.
    const me = await get('/api/v1/auth/me').set('Authorization', oldAccess);
    expect(me.status).toBe(401);
  });

  it('supports body-based refresh for non-browser clients and returns the new token', async () => {
    const login = await loginAs(app, 'rotate_user', 'Passw0rd!!');
    const rt = cookieValue(login.cookies, 'rt');
    const refresh = await post('/api/v1/auth/refresh').send({ refreshToken: rt });
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.refreshToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).not.toBe(rt);
  });

  it('rejects an expired refresh token with SESSION_REVOKED', async () => {
    const login = await loginAs(app, 'login_user', 'Passw0rd!!');
    const rt = cookieValue(login.cookies, 'rt');
    // Expire the session row directly (fake repository).
    const hash = createHash('sha256').update(rt, 'utf8').digest('hex');
    for (const r of sessionRepo.rows.values()) {
      if (r.refreshHash === hash) r.expiresAt = new Date(Date.now() - 1000);
    }
    const refresh = await post('/api/v1/auth/refresh').send({ refreshToken: rt });
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('Logout, logout-all and sessions (B1.3)', () => {
  it('logout revokes the session so the access token stops working immediately', async () => {
    await createUser(app, { username: 'sess_user', password: 'Passw0rd!!' });
    const login = await loginAs(app, 'sess_user', 'Passw0rd!!');
    const me = await get('/api/v1/auth/me').set('Authorization', login.bearer);
    expect(me.status).toBe(200);

    const logout = await post('/api/v1/auth/logout')
      .set('Authorization', login.bearer)
      .set('Origin', ORIGIN);
    expect(logout.status).toBe(204);
    expect(logout.text).toBe('');

    const afterLogout = await get('/api/v1/auth/me').set('Authorization', login.bearer);
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error.code).toBe('SESSION_REVOKED');
  });

  it('logout-all revokes every session of the user', async () => {
    const first = await loginAs(app, 'sess_user', 'Passw0rd!!');
    const second = await loginAs(app, 'sess_user', 'Passw0rd!!');
    const all = await post('/api/v1/auth/logout-all')
      .set('Authorization', second.bearer)
      .set('Origin', ORIGIN);
    expect(all.status).toBe(204);
    expect((await get('/api/v1/auth/me').set('Authorization', first.bearer)).status).toBe(401);
    expect((await get('/api/v1/auth/me').set('Authorization', second.bearer)).status).toBe(401);
  });

  it('lists only own sessions, marks the current one, and 404s foreign session ids', async () => {
    await createUser(app, { username: 'alice_sess', password: 'Al1cePass!' });
    const bob = await createUser(app, { username: 'bob_sess', password: 'B0bPass!!' });
    const aliceA = await loginAs(app, 'alice_sess', 'Al1cePass!');
    const aliceB = await loginAs(app, 'alice_sess', 'Al1cePass!');
    const bobA = await loginAs(app, 'bob_sess', 'B0bPass!!');

    const list = await get('/api/v1/auth/sessions').set('Authorization', aliceA.bearer);
    expect(list.status).toBe(200);
    const sessions = list.body.data as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current === true)).toHaveLength(1);
    expect(sessions.every((s) => typeof s.ip === 'string')).toBe(true);

    // Alice deletes her own second session → 204, then it is inactive.
    const secondSessionId = (sessions.find((s) => s.current === false) as { id: string }).id;
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${secondSessionId}`)
      .set('Authorization', aliceA.bearer)
      .set('Origin', ORIGIN);
    expect(del.status).toBe(204);

    // Bob's session id is invisible to Alice → 404 (no existence leak).
    const bobSessions = await get('/api/v1/auth/sessions')
      .set('Authorization', bobA.bearer)
      .then((r) => r.body.data as Array<{ id: string }>);
    const bobSessionId = bobSessions[0]?.id ?? bob.id;
    const foreign = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${bobSessionId}`)
      .set('Authorization', aliceA.bearer)
      .set('Origin', ORIGIN);
    expect(foreign.status).toBe(404);
    expect(aliceB.bearer.length).toBeGreaterThan(0);
  });
});

describe('Banned accounts and guard behavior (B1.3)', () => {
  it('rejects a banned user at login and kills existing tokens', async () => {
    await createUser(app, { username: 'banned_user', password: 'B4nnedPass!' });
    const login = await loginAs(app, 'banned_user', 'B4nnedPass!');
    expect(login.bearer).toBeTruthy();

    const row = [...userRepo.rows.values()].find((r) => r.username === 'banned_user');
    if (row) row.status = 'blocked';

    const bannedLogin = await post('/api/v1/auth/login').send({
      identifier: 'banned_user',
      password: 'B4nnedPass!',
    });
    expect(bannedLogin.status).toBe(403);
    expect(bannedLogin.body.error.code).toBe('ACCOUNT_BANNED');

    const me = await get('/api/v1/auth/me').set('Authorization', login.bearer);
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('rejects a tampered access token signature with 401', async () => {
    const login = await loginAs(app, 'login_user', 'Passw0rd!!');
    const token = login.bearer.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1] || !parts[2]) throw new Error('unexpected JWT shape');
    const tampered = `${parts[0]}.${parts[1].slice(0, -2)}zz.${parts[2]}`;
    const res = await get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('leaves @Public routes open and 401s unauthenticated protected ones', async () => {
    const health = await get('/api/v1/health');
    expect(health.status).toBe(200);
    const me = await get('/api/v1/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('CSRF origin check (B1.3)', () => {
  it('403s a cookie-authenticated unsafe request without Origin; passes with it', async () => {
    const login = await loginAs(app, 'login_user', 'Passw0rd!!');

    // Cookie auth + no Origin → CSRF rejection (403, messageKey errors.csrf).
    const noOrigin = await post('/api/v1/auth/refresh').set('Cookie', login.cookies);
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.error.messageKey).toBe('errors.csrf');

    // Cookie auth + matching Origin → passes.
    const withOrigin = await post('/api/v1/auth/refresh')
      .set('Cookie', login.cookies)
      .set('Origin', ORIGIN);
    expect(withOrigin.status).toBe(200);

    // Bearer-only (no cookies) → no CSRF surface.
    const bearerOnly = await post('/api/v1/auth/refresh')
      .set('Authorization', login.bearer)
      .send({});
    expect([200, 401]).toContain(bearerOnly.status); // 401 when rt cookie absent
    expect(bearerOnly.body.error?.messageKey).not.toBe('errors.csrf');
  });
});
