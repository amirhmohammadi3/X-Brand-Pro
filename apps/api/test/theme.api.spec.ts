import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { REDIS } from '../src/redis/redis.client.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AppModule } from '../src/app.module.js';
import { seedThemePacks } from '../src/db/seed/theme.seed.js';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';
import { databaseAvailable, databaseReachableSync, prepareTestDatabase } from './db.js';
import { FakeRedis } from './fake-redis.js';

process.env.DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.TEST_DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.PUBLIC_WEB_URL = 'http://localhost:3100';
if (!process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENCRYPTION_KEY.length < 32) {
  process.env.SETTINGS_ENCRYPTION_KEY = 'theme-spec-key-0123456789abcdef-0123456789abcdef';
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

let app: INestApplication;
let pool: Pool | null = null;
let superAdmin: LoginSession;
let plainUser: LoginSession;

const ORIGIN = 'http://localhost:3100';

function authed(
  cookies: string[],
  verb: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) {
  return request(app.getHttpServer())
    [verb](path)
    .set('Cookie', cookies.join('; '))
    .set('Origin', ORIGIN);
}

beforeAll(async () => {
  if (!(await databaseAvailable())) {
    console.warn('[theme.api.spec] test database unavailable — suite skipped');
    return;
  }
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
  await prepareTestDatabase();
  await pool.query(
    'truncate table theme_packs, settings, translations, languages, users, media_files, otp_codes, sessions, oauth_accounts, audit_logs cascade',
  );
  await seedThemePacks(TEST_DB_URL!, () => undefined);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(new FakeRedis())
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  await createUser(app, {
    username: 'theme-root',
    password: 'Sup3r-Secret!',
    email: 'theme-root@example.com',
    role: 'super_admin',
  });
  await createUser(app, {
    username: 'theme-user',
    password: 'Us3r-Secret!',
    email: 'theme-user@example.com',
    role: 'user',
  });
  superAdmin = await loginAs(app, 'theme-root', 'Sup3r-Secret!');
  plainUser = await loginAs(app, 'theme-user', 'Us3r-Secret!');
}, 30_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  await pool?.query('delete from audit_logs');
});

// Real skip: no Postgres reachable ⇒ the whole suite skips (printed reason).
describe.skipIf(!databaseReachableSync())('theme API (B1.13)', () => {
  it('permission matrix: admin endpoints are 401 anon, 403 user, 200 super_admin', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/theme/active-x').expect(404);
    await request(app.getHttpServer())
      .put('/api/v1/admin/theme/active')
      .send({ packId: 'luxe' })
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/v1/admin/theme/active')
      .set('Authorization', plainUser.bearer)
      .set('Origin', ORIGIN)
      .send({ packId: 'luxe' })
      .expect(403);
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/theme/active')
      .send({ packId: 'modern' })
      .expect(200);
  });

  it('GET /theme returns the active pack with an ETag and version string', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/theme').expect(200);
    expect(res.body.data.pack.id).toBe('modern');
    expect(res.body.data.pack.tokens.light.primary).toBe('#4338CA');
    expect(res.body.data.version).toMatch(/^modern:\d+:[0-9a-f]{8}$/);
    expect(res.headers.etag).toBeDefined();
  });

  it('setActive switches the pack immediately (cache invalidated) and is audited', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/theme').expect(200);
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/theme/active')
      .send({ packId: 'luxe' })
      .expect(200);
    const after = await request(app.getHttpServer()).get('/api/v1/theme').expect(200);
    expect(after.body.data.pack.id).toBe('luxe');
    expect(after.body.data.pack.tokens.dark.primary).toBe('#D4AF37');
    expect(after.body.data.version).not.toBe(before.body.data.version);

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const res = await pool!.query<{ action: string }>(
        "select action from audit_logs where action = 'theme.active.set'",
      );
      found = res.rows.length > 0;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(found).toBe(true);

    // Restore modern for later tests.
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/theme/active')
      .send({ packId: 'modern' })
      .expect(200);
  });

  it('pack list carries 5-color previews and the full pack endpoint serves tokens', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/theme/packs').expect(200);
    const ids: string[] = list.body.data.items.map((p: { id: string }) => p.id);
    expect(ids.sort()).toEqual(['luxe', 'modern', 'warm']);
    const warm = list.body.data.items.find((p: { id: string }) => p.id === 'warm');
    expect(warm.preview.light).toHaveLength(5);
    expect(warm.preview.dark[0]).toBe('#1C1410');

    const full = await request(app.getHttpServer()).get('/api/v1/theme/packs/warm').expect(200);
    expect(full.body.data.tokens.density).toBe('comfortable');
    expect(full.body.data.tokens.controlHeightPx).toBe(44);

    await request(app.getHttpServer()).get('/api/v1/theme/packs/nope').expect(404);
  });

  it('updateTokens rejects a low-contrast edit with the failing pair named (422)', async () => {
    const pack = await request(app.getHttpServer()).get('/api/v1/theme/packs/modern').expect(200);
    const tokens = pack.body.data.tokens;
    tokens.light.text = tokens.light.bg; // text == bg → contrast 1:1
    const res = await authed(superAdmin.cookies, 'put', '/api/v1/admin/theme/packs/modern')
      .send({ tokens })
      .expect(422);
    const pairs: Array<{ mode: string; pair: string; ratio: number; min: number }> =
      res.body.error.details.failedPairs;
    expect(pairs.some((f) => f.mode === 'light' && f.pair === 'text/bg' && f.min === 4.5)).toBe(
      true,
    );
  });

  it('updateTokens accepts a valid edit, bumps the version, and reset restores shipped values', async () => {
    const pack = await request(app.getHttpServer()).get('/api/v1/theme/packs/warm').expect(200);
    const tokens = pack.body.data.tokens;
    tokens.dark.muted = '#C4AFA0'; // slightly lighter; still passes contrast
    const edited = await authed(superAdmin.cookies, 'put', '/api/v1/admin/theme/packs/warm')
      .send({ tokens })
      .expect(200);
    expect(edited.body.data.version).toBe(pack.body.data.version + 1);

    const afterEdit = await request(app.getHttpServer())
      .get('/api/v1/theme/packs/warm')
      .expect(200);
    expect(afterEdit.body.data.tokens.dark.muted).toBe('#C4AFA0');

    const reset = await authed(superAdmin.cookies, 'post', '/api/v1/admin/theme/packs/warm/reset')
      .send()
      .expect(201);
    expect(reset.body.data.version).toBe(pack.body.data.version + 2);
    expect(reset.body.data.tokens.dark.muted).toBe('#CDB8A8');
  });

  it('editing tokens is audit-logged (theme.tokens.update)', async () => {
    const pack = await request(app.getHttpServer()).get('/api/v1/theme/packs/luxe').expect(200);
    const tokens = pack.body.data.tokens;
    tokens.dark.muted = '#B3AB99';
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/theme/packs/luxe')
      .send({ tokens })
      .expect(200);
    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const res = await pool!.query<{ action: string }>(
        "select action from audit_logs where action = 'theme.tokens.update'",
      );
      found = res.rows.length > 0;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(found).toBe(true);
    await authed(superAdmin.cookies, 'post', '/api/v1/admin/theme/packs/luxe/reset')
      .send()
      .expect(201);
  });
});
