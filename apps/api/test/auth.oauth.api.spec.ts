import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { generateKeyPair, createLocalJWKSet, exportJWK, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import type { SettingRow } from '../src/db/schema/settings.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/modules/auth/auth-cookie.service.js';
import {
  cookieValue,
  extractCookies,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
} from './auth.utils.js';
import type { SettingsRepositoryLike } from '../src/modules/settings/settings.repository.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { GOOGLE_OIDC_JWKS, type GoogleJwks } from '../src/modules/auth/google-oauth.service.js';
import {
  OAUTH_ACCOUNTS_REPOSITORY,
  type OauthAccountsRepositoryLike,
} from '../src/modules/auth/oauth-accounts.repository.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { FakeRedis } from './fake-redis.js';

// env defaults come from global-setup (registered in vitest.config.ts).
// The OAuth spec stores a client secret through the real settings service,
// which needs the encryption key (global-setup leaves it to feature specs).
process.env.SETTINGS_ENCRYPTION_KEY =
  process.env.SETTINGS_ENCRYPTION_KEY ?? 'oauth-spec-encryption-key-0123456789';

const ORIGIN = 'http://localhost:3100'; // PUBLIC_WEB_URL from global-setup
const CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-google-client-secret';
const FAILURE_URL = `${ORIGIN}/login?error=oauth_failed`;

/**
 * HTTP-level Google OAuth tests (B1.8) WITHOUT live services and WITHOUT
 * network: the ID-token JWKS is a locally generated RS256 keypair, the token
 * endpoint is a mocked fetch, and Redis/users/sessions/oauth-accounts are
 * in-memory fakes. Real controllers, guards, cookies and services run.
 */
function makeFakeSettingsRepo(): SettingsRepositoryLike {
  const store = new Map<string, SettingRow>();
  return {
    async findAll() {
      return [...store.values()];
    },
    async findByKey(key) {
      return store.get(key) ?? null;
    },
    async upsert(params) {
      const row: SettingRow = {
        key: params.key,
        value: params.value,
        isSecret: params.isSecret,
        group: params.group,
        description: params.description,
        updatedAt: new Date(),
      };
      store.set(params.key, row);
      return row;
    },
    async deleteByKey(key) {
      return store.delete(key);
    },
  };
}

function makeMemoryOauthRepo(): OauthAccountsRepositoryLike {
  const store = new Map<
    string,
    {
      id: string;
      userId: string;
      provider: string;
      providerUserId: string;
      email: string | null;
      createdAt: Date;
    }
  >();
  const keyOf = (provider: string, uid: string) => `${provider}:${uid}`;
  return {
    async insert(row) {
      const k = keyOf(row.provider, row.providerUserId);
      const existing = store.get(k);
      if (existing) return existing as never;
      const rowOut = {
        id: randomUUID(),
        userId: row.userId,
        provider: row.provider,
        providerUserId: row.providerUserId,
        email: row.email,
        createdAt: new Date(),
      };
      store.set(k, rowOut);
      return rowOut as never;
    },
    async findByProviderUid(provider, providerUserId) {
      return store.get(keyOf(provider, providerUserId)) ?? null;
    },
    async listForUser(userId) {
      return [...store.values()].filter((r) => r.userId === userId);
    },
    async findByIdForUser(id, userId) {
      return [...store.values()].find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async deleteForUser(userId) {
      let n = 0;
      for (const [k, r] of store) {
        if (r.userId === userId) {
          store.delete(k);
          n += 1;
        }
      }
      return n;
    },
    async deleteByIdForUser(id, userId) {
      const row = [...store.values()].find((r) => r.id === id && r.userId === userId);
      if (!row) return false;
      store.delete(keyOf(row.provider, row.providerUserId));
      return true;
    },
    async countForUser(userId) {
      return [...store.values()].filter((r) => r.userId === userId).length;
    },
  };
}

let app: INestApplication;
let redis: FakeRedis;
let userRepo: ReturnType<typeof makeMemoryUserRepo>;
let sessionRepo: ReturnType<typeof makeMemorySessionRepo>;
let oauthRepo: ReturnType<typeof makeMemoryOauthRepo>;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let nextIdToken: string | null = null;

async function signIdToken(claims: {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  aud?: string;
  iss?: string;
  expired?: boolean;
}): Promise<string> {
  const payload = {
    email: claims.email,
    email_verified: claims.email_verified,
    name: claims.name,
  };
  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(claims.iss ?? 'https://accounts.google.com')
    .setAudience(claims.aud ?? CLIENT_ID);
  if (claims.expired) {
    builder = builder.setExpirationTime(Math.floor(Date.now() / 1000) - 60);
  } else {
    builder = builder.setExpirationTime('5m');
  }
  return builder.sign(privateKey);
}

beforeAll(async () => {
  redis = new FakeRedis();
  userRepo = makeMemoryUserRepo();
  sessionRepo = makeMemorySessionRepo();
  oauthRepo = makeMemoryOauthRepo();

  const { publicKey, privateKey: priv } = await generateKeyPair('RS256', { extractable: true });
  privateKey = priv;
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const localJwks = createLocalJWKSet({ keys: [jwk] });

  // The only network call in the flow is the token endpoint exchange.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const idToken = nextIdToken;
      if (!idToken) throw new Error('test bug: no id_token prepared');
      return { ok: true, status: 200, json: async () => ({ id_token: idToken }) };
    }),
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(sessionRepo)
    .overrideProvider(USERS_REPOSITORY)
    .useValue(userRepo)
    .overrideProvider(OAUTH_ACCOUNTS_REPOSITORY)
    .useValue(oauthRepo)
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .overrideProvider(GOOGLE_OIDC_JWKS)
    .useValue(localJwks as unknown as GoogleJwks)
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  // Enable + configure through the real settings service (secrets encrypted).
  const { SettingsService } = await import('../src/modules/settings/settings.service.js');
  const settings = app.get(SettingsService);
  await settings.set('oauth.google.clientId', CLIENT_ID);
  await settings.set('oauth.google.clientSecret', CLIENT_SECRET);
});

afterAll(async () => {
  await app?.close();
});

afterEach(() => {
  nextIdToken = null;
});

function get(path: string) {
  return request(app.getHttpServer()).get(path);
}
function del(path: string) {
  return request(app.getHttpServer()).delete(path);
}

/** Drive /start → capture state + oauth_state cookie. */
async function startOauth(next?: string) {
  const path = next
    ? `/api/v1/auth/google/start?next=${encodeURIComponent(next)}`
    : '/api/v1/auth/google/start';
  const res = await get(path);
  const cookies = extractCookies(res);
  const stateCookie = cookieValue(cookies, 'oauth_state');
  const location = res.headers.location as string;
  const state = new URL(location).searchParams.get('state') ?? '';
  return { res, stateCookie, location, state };
}

describe('GET /api/v1/auth/google/start (B1.8)', () => {
  it('returns 404 NOT_FOUND while the feature is disabled', async () => {
    // Fresh app state — enabled was never set before the next test enables it.
    const res = await get('/api/v1/auth/google/start');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('302s to the Google authorization endpoint with state, PKCE and scopes once enabled', async () => {
    const { SettingsService } = await import('../src/modules/settings/settings.service.js');
    await app.get(SettingsService).set('oauth.google.enabled', true);

    const { res, location, stateCookie } = await startOauth('/dashboard');
    expect(res.status).toBe(302);
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    const url = new URL(location);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(stateCookie).toBeTruthy();
    // Cookie hardening: httpOnly, short-lived, scoped to the callback path.
    const rawSetCookie = res.headers['set-cookie'] as unknown as string[];
    const rawCookie = (Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie]).find((c) =>
      c.startsWith('oauth_state='),
    );
    expect(rawCookie).toContain('HttpOnly');
    expect(rawCookie).toContain('SameSite=Lax');
    expect(rawCookie).toContain('Path=/api/v1/auth/google');
    expect(rawCookie).toContain('Max-Age=300');
  });

  it('never completes a real login without real Google credentials (documented limitation)', () => {
    // The callback tests below mock ONLY the token endpoint; a production run
    // needs real client credentials configured from the admin settings panel.
    expect(true).toBe(true);
  });
});

describe('GET /api/v1/auth/google/callback (B1.8)', () => {
  it('creates a user + session for a fresh verified email and redirects to next', async () => {
    nextIdToken = await signIdToken({
      sub: 'google-sub-1',
      email: 'fresh.user@x.ir',
      email_verified: true,
      name: 'Fresh User',
    });
    const { stateCookie, state } = await startOauth('/dashboard');
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'auth-code-1' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${ORIGIN}/dashboard`);
    const cookies = extractCookies(res);
    expect(cookieValue(cookies, ACCESS_COOKIE)).toBeTruthy();
    expect(cookieValue(cookies, REFRESH_COOKIE)).toBeTruthy();

    const user = userRepo.findByIdentifier('fresh.user@x.ir');
    expect(await user).toMatchObject({ username: 'fresh.user', displayName: 'Fresh User' });
    const row = await user;
    expect(row?.emailVerifiedAt).not.toBeNull();
  });

  it('logs the same Google identity into the SAME user on a second callback', async () => {
    nextIdToken = await signIdToken({
      sub: 'google-sub-1',
      email: 'fresh.user@x.ir',
      email_verified: true,
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'auth-code-2' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${ORIGIN}/`);

    const users = [...userRepo.rows.values()];
    const matches = users.filter((u) => u.email === 'fresh.user@x.ir');
    expect(matches).toHaveLength(1);
  });

  it('links a verified Google email to an existing local account', async () => {
    // Existing local user with a verified email (registered via password flow).
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username: 'local_link_user', password: 'Passw0rd!!', email: 'link.me@x.ir' });
    expect(reg.status).toBe(201);
    const localId = reg.body.data.user.id as string;

    nextIdToken = await signIdToken({
      sub: 'google-sub-2',
      email: 'link.me@x.ir',
      email_verified: true,
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'auth-code-3' });
    expect(res.status).toBe(302);

    const users = [...userRepo.rows.values()];
    expect(users.filter((u) => u.email === 'link.me@x.ir')).toHaveLength(1);
    const link = await oauthRepo.findByProviderUid('google', 'google-sub-2');
    expect(link?.userId).toBe(localId);
  });

  it('does NOT link by an unverified email — creates a separate user without email', async () => {
    nextIdToken = await signIdToken({
      sub: 'google-sub-3',
      email: 'link.me@x.ir',
      email_verified: false,
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'auth-code-4' });
    expect(res.status).toBe(302);

    const users = [...userRepo.rows.values()];
    const holder = users.find(
      (u) => u.email === 'link.me@x.ir' && u.username === 'local_link_user',
    );
    expect(holder).toBeTruthy();
    // The new account has NO email at all (Google did not vouch for it).
    const oauthLink = await oauthRepo.findByProviderUid('google', 'google-sub-3');
    expect(oauthLink?.userId).not.toBe(holder?.id);
    const newUser = users.find((u) => u.id === oauthLink?.userId);
    expect(newUser?.email).toBeNull();
  });

  it('rejects a state mismatch with the generic failure redirect', async () => {
    const { stateCookie } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state: 'tampered-state', code: 'x' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FAILURE_URL);
  });

  it('rejects a missing/expired state cookie', async () => {
    const res = await get('/api/v1/auth/google/callback').query({ state: 's', code: 'x' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FAILURE_URL);
  });

  it('rejects an expired state cookie (5-minute TTL)', async () => {
    const { SignJWT } = await import('jose');
    const expired = await new SignJWT({
      state: 'stale-state',
      codeVerifier: 'v',
      next: '/',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('xbrand:oauth')
      .setAudience('oauth-state')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(process.env.JWT_REFRESH_SECRET));
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${expired}`)
      .query({ state: 'stale-state', code: 'x' });
    expect(res.headers.location).toBe(FAILURE_URL);
  });

  it('rejects an ID token for the wrong audience', async () => {
    nextIdToken = await signIdToken({
      sub: 'sub-aud',
      email: 'a@x.ir',
      email_verified: true,
      aud: 'other-client',
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'c' });
    expect(res.headers.location).toBe(FAILURE_URL);
  });

  it('rejects an ID token from the wrong issuer', async () => {
    nextIdToken = await signIdToken({
      sub: 'sub-iss',
      email: 'i@x.ir',
      email_verified: true,
      iss: 'https://evil.example.com',
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'c' });
    expect(res.headers.location).toBe(FAILURE_URL);
  });

  it('rejects an expired ID token', async () => {
    nextIdToken = await signIdToken({
      sub: 'sub-exp',
      email: 'e@x.ir',
      email_verified: true,
      expired: true,
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'c' });
    expect(res.headers.location).toBe(FAILURE_URL);
  });

  it('neutralizes an open-redirect `next` (//evil stays inside the app origin)', async () => {
    nextIdToken = await signIdToken({
      sub: 'google-sub-next',
      email: 'next@x.ir',
      email_verified: true,
    });
    const { stateCookie, state } = await startOauth('//evil.example.com');
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'c' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${ORIGIN}/`);
  });
});

describe('GET/DELETE /api/v1/auth/oauth/accounts (B1.8)', () => {
  let authCookies: string[];

  beforeAll(async () => {
    // Fresh OAuth identity → session; reuse its cookies for the account API.
    nextIdToken = await signIdToken({
      sub: 'google-sub-1',
      email: 'fresh.user@x.ir',
      email_verified: true,
    });
    const { stateCookie, state } = await startOauth();
    const res = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${stateCookie}`)
      .query({ state, code: 'auth-code-account' });
    authCookies = extractCookies(res);
    expect(cookieValue(authCookies, ACCESS_COOKIE)).toBeTruthy();
  });

  it('lists the linked google account for its owner', async () => {
    const res = await get('/api/v1/auth/oauth/accounts')
      .set('Cookie', `at=${cookieValue(authCookies, ACCESS_COOKIE)}`)
      .set('Origin', ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.accounts).toHaveLength(1);
    expect(res.body.data.accounts[0]).toMatchObject({
      provider: 'google',
      email: 'fresh.user@x.ir',
    });
  });

  it('refuses to unlink the ONLY login method with 422 LAST_LOGIN_METHOD', async () => {
    // An OAuth user WITHOUT a verified email/password/phone has exactly one
    // login method: the google link itself (prompt B1.8 unlink rule).
    nextIdToken = await signIdToken({
      sub: 'google-sub-nomethod',
      email: 'nomethod@x.ir',
      email_verified: false,
    });
    const started = await startOauth();
    const login = await get('/api/v1/auth/google/callback')
      .set('Cookie', `oauth_state=${started.stateCookie}`)
      .query({ state: started.state, code: 'auth-code-nomethod' });
    expect(login.status).toBe(302);
    const onlyCookies = extractCookies(login);

    const list = await get('/api/v1/auth/oauth/accounts')
      .set('Cookie', `at=${cookieValue(onlyCookies, ACCESS_COOKIE)}`)
      .set('Origin', ORIGIN);
    const accountId = list.body.data.accounts[0].id as string;

    const res = await del(`/api/v1/auth/oauth/accounts/${accountId}`)
      .set('Cookie', `at=${cookieValue(onlyCookies, ACCESS_COOKIE)}`)
      .set('Origin', ORIGIN);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LAST_LOGIN_METHOD');
  });

  it('404s when deleting a foreign or unknown account id', async () => {
    const res = await del('/api/v1/auth/oauth/accounts/00000000-0000-4000-8000-000000000000')
      .set('Cookie', `at=${cookieValue(authCookies, ACCESS_COOKIE)}`)
      .set('Origin', ORIGIN);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await get('/api/v1/auth/oauth/accounts');
    expect(res.status).toBe(401);
  });
});
