import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { DrizzleClient } from '../src/db/drizzle.client.js';
import { auditLogs } from '../src/db/schema/audit.js';
import { Pool } from 'pg';

/**
 * The sandbox exports a non-postgres DATABASE_URL globally (file:...); tests
 * must run against the real test database. Global-setup only fills defaults,
 * so normalize non-postgres values here (before any DI parses the env).
 */
// The audit trail (app DrizzleClient), the mirrored users and the scanning
// pool MUST share one database. .env points DATABASE_URL at a separate dev
// database; force both at the test database before any DI parses the env.
process.env.DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.TEST_DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
// .env ships PUBLIC_WEB_URL=:3000; the suite's Origin is :3100 (the
// global-setup default). Align them so the CSRF origin check passes.
process.env.PUBLIC_WEB_URL = 'http://localhost:3100';
// Secret settings need a stable, long-enough encryption key in tests.
if (!process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENCRYPTION_KEY.length < 32) {
  process.env.SETTINGS_ENCRYPTION_KEY = 'audit-spec-key-0123456789abcdef-0123456789abcdef';
}

let pool: Pool | null = null;
function requirePool(): Pool {
  if (!pool) throw new Error('test pool not initialised (db unavailable?)');
  return pool;
}
import { databaseAvailable, prepareTestDatabase } from './db.js';
import { FakeRedis } from './fake-redis.js';
import { createUser, loginAs, makeMemorySessionRepo, makeMemoryUserRepo } from './auth.utils.js';

/**
 * Audit API tests (B1.11). Auth flows run on in-memory user/session fakes
 * (as in auth.api.spec) while the audit trail itself writes through the REAL
 * DrizzleClient into the test database — so the endpoint, the subscriber
 * wiring and the row shapes are all exercised end to end.
 */
let app: INestApplication;
let redis: FakeRedis;
let sessionRepo: ReturnType<typeof makeMemorySessionRepo>;
let userRepo: ReturnType<typeof makeMemoryUserRepo>;
let client: DrizzleClient;

beforeAll(async () => {
  if (!(await databaseAvailable())) {
    console.warn('[audit.api.spec] test database unavailable — suite skipped');
    return;
  }
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  await prepareTestDatabase();
  // Re-run durability: clear the tables the suite mutates (users CASCADE
  // reaches sessions, oauth_accounts and audit_logs via their FKs).
  await pool!.query(
    'truncate table users, settings, media_files, otp_codes, sessions, oauth_accounts, audit_logs cascade',
  );
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

  // Audit rows reference real users (FK). The fake repo mints users the real
  // table has never seen — mirror every created user into it.
  const originalCreate = userRepo.create.bind(userRepo);
  userRepo.create = async (params) => {
    const row = await originalCreate(params);
    await requirePool().query(
      `insert into users (id, username, role, status, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now()) on conflict (id) do nothing`,
      [row.id, row.username, row.role, row.status],
    );
    return row;
  };

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();
  client = app.get(DrizzleClient);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  await requirePool().query('delete from audit_logs');
});

const ORIGIN = 'http://localhost:3100';

function authed(cookies: string[], verb: 'get' | 'put' | 'delete' | 'post', path: string) {
  return request(app.getHttpServer())
    [verb](path)
    .set('Cookie', cookies.join('; '))
    .set('Origin', ORIGIN);
}

/** Waits until `count` rows exist for an action (subscriber is async). */
async function waitForRows(action: string, count: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await pool!.query('select count(*)::int as n from audit_logs where action = $1', [
      action,
    ]);
    if ((res.rows[0]?.n ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`audit rows for "${action}" did not reach ${count} in time`);
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'GET /api/v1/admin/audit-logs permission matrix (B1.11)',
  () => {
    it('401 anonymous, 403 user and moderator, 200 admin and super_admin', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/audit-logs').expect(401);

      await createUser(app, { username: 'plain_user1', password: 'Sup3rSecret!', role: 'user' });
      const user = await loginAs(app, 'plain_user1', 'Sup3rSecret!');
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', user.bearer)
        .expect(403);

      await createUser(app, { username: 'mod_user1', password: 'Sup3rSecret!', role: 'moderator' });
      const mod = await loginAs(app, 'mod_user1', 'Sup3rSecret!');
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', mod.bearer)
        .expect(403);

      await createUser(app, { username: 'admin_user1', password: 'Sup3rSecret!', role: 'admin' });
      const admin = await loginAs(app, 'admin_user1', 'Sup3rSecret!');
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', admin.bearer)
        .expect(200);
      // The admin's own register/login events are already in the trail.
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(
        res.body.data.items.every((item: { action: string }) => item.action.startsWith('auth.')),
      ).toBe(true);

      await createUser(app, {
        username: 'super_user1',
        password: 'Sup3rSecret!',
        role: 'super_admin',
      });
      const superAdmin = await loginAs(app, 'super_user1', 'Sup3rSecret!');
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', superAdmin.bearer)
        .expect(200);
    });
  },
);

describe.skipIf(!process.env.TEST_DATABASE_URL)('audit rows for auth flows (B1.11)', () => {
  it('writes auth.register, auth.login and auth.logout rows with the actor', async () => {
    // register → auth.register (controller emits via AuthService.register)
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: 'audit_target',
        password: 'Sup3rSecret!',
        email: 'audit_target@example.com',
      })
      .expect(201);
    await waitForRows('auth.register', 1);

    const login = await loginAs(app, 'audit_target', 'Sup3rSecret!');
    await waitForRows('auth.login', 1);

    await authed(login.cookies, 'post', '/api/v1/auth/logout').send({}).expect([200, 204]);
    await waitForRows('auth.logout', 1);

    const admin = await createUser(app, {
      username: 'trail_admin',
      password: 'Sup3rSecret!',
      role: 'admin',
    });
    const adminSession = await loginAs(app, 'trail_admin', 'Sup3rSecret!');
    const res = await authed(
      adminSession.cookies,
      'get',
      '/api/v1/admin/audit-logs?action=auth.*&limit=20',
    ).expect(200);
    const actions = res.body.data.items.map((item: { action: string }) => item.action);
    expect(actions).toContain('auth.register');
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.logout');

    // Register row carries the actor (the registering user).
    const registerRow = res.body.data.items.find(
      (item: { action: string }) => item.action === 'auth.register',
    );
    const target = userRepo.rows.get(admin.id); // admin row exists
    expect(target).toBeDefined();
    expect(registerRow.actor).toMatchObject({ username: 'audit_target' });
  });

  it('samples failed logins: a burst writes at most one row per minute', async () => {
    await createUser(app, { username: 'fail_target', password: 'Sup3rSecret!' });
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: 'fail_target', password: 'WrongPass1' })
        .expect(401);
    }
    await waitForRows('auth.login_failed', 1);
    // Allow the async writes to settle, then assert the cap holds.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const res = await pool!.query('select count(*)::int as n from audit_logs where action = $1', [
      'auth.login_failed',
    ]);
    expect(res.rows[0]?.n).toBeLessThanOrEqual(2); // 1 by sampling, +1 if a window boundary was crossed
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('settings audit + secret safety (B1.11)', () => {
  it('records settings.update with the actor, redacts secrets, never stores plaintext', async () => {
    await createUser(app, { username: 'settings_admin1', password: 'Sup3rSecret!', role: 'admin' });
    const admin = await loginAs(app, 'settings_admin1', 'Sup3rSecret!');

    // Public (non-secret) setting: before/after in the clear.
    await authed(admin.cookies, 'put', '/api/v1/admin/settings/site.name')
      .send({ value: 'آزمون برند' })
      .expect(200);
    await waitForRows('settings.update', 1);

    // SECRET setting: plaintext must NEVER reach audit_logs.
    const secretValue = 'ULTRA-SECRET-KEY-9876';
    await authed(admin.cookies, 'put', '/api/v1/admin/settings/sms.kavenegar.apiKey')
      .send({ value: secretValue })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const scan = await pool!.query(
      "select before, after from audit_logs where action = 'settings.update' and entity_id = 'sms.kavenegar.apiKey'",
    );
    expect(scan.rows.length).toBeGreaterThan(0);
    // Secrets are recorded masked (the project SECRET_MASK) with a changed
    // flag — never plaintext.
    expect(JSON.stringify(scan.rows)).not.toContain(secretValue);
    expect(JSON.stringify(scan.rows)).toContain('••••••••');
    expect(JSON.stringify(scan.rows)).toContain('"changed":true');

    // Whole-table scan: the plaintext secret appears nowhere.
    const full = await pool!.query('select * from audit_logs');
    expect(JSON.stringify(full.rows)).not.toContain(secretValue);
  });

  it('rejects an empty secret value with 422 and honours clear:true as a reset', async () => {
    await createUser(app, { username: 'clear_admin1', password: 'Sup3rSecret!', role: 'admin' });
    const admin = await loginAs(app, 'clear_admin1', 'Sup3rSecret!');

    await authed(admin.cookies, 'put', '/api/v1/admin/settings/sms.melipayamak.username')
      .send({ value: 'real-user' })
      .expect(200);
    await authed(admin.cookies, 'put', '/api/v1/admin/settings/sms.melipayamak.username')
      .send({ value: '' })
      .expect(422);
    await authed(admin.cookies, 'put', '/api/v1/admin/settings/sms.melipayamak.username')
      .send({ value: '', clear: true })
      .expect(200);
    await waitForRows('settings.reset', 1);

    const scan = await pool!.query(
      "select count(*)::int as n from audit_logs where action = 'settings.reset' and entity_id = 'sms.melipayamak.username'",
    );
    expect(scan.rows[0]?.n).toBe(1);
  });

  it('unknown setting key is still 404/422 and writes nothing', async () => {
    await createUser(app, { username: 'nokey_admin1', password: 'Sup3rSecret!', role: 'admin' });
    const admin = await loginAs(app, 'nokey_admin1', 'Sup3rSecret!');
    await authed(admin.cookies, 'put', '/api/v1/admin/settings/not.a.key')
      .send({ value: 'x' })
      .expect(422);
    const scan = await pool!.query(
      "select count(*)::int as n from audit_logs where entity_id = 'not.a.key'",
    );
    expect(scan.rows[0]?.n).toBe(0);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('audit list pagination + filters (B1.11)', () => {
  it('pages deterministically and honours action prefix/entity filters', async () => {
    // Seed 25 rows directly (created_at identical is the interesting case).
    for (let i = 0; i < 25; i += 1) {
      await client.db.insert(auditLogs).values({
        action: 'seed.filler',
        entityType: 'thing',
        entityId: `t-${i}`,
        after: { i },
      });
    }
    await createUser(app, { username: 'page_admin1', password: 'Sup3rSecret!', role: 'admin' });
    const admin = await loginAs(app, 'page_admin1', 'Sup3rSecret!');

    const page1 = await authed(admin.cookies, 'get', '/api/v1/admin/audit-logs?limit=10').expect(
      200,
    );
    expect(page1.body.data.items).toHaveLength(10);
    expect(page1.body.data.meta.hasMore).toBe(true);
    expect(page1.body.data.meta.nextCursor).toBeTruthy();

    const page2 = await authed(
      admin.cookies,
      'get',
      `/api/v1/admin/audit-logs?limit=10&cursor=${encodeURIComponent(page1.body.data.meta.nextCursor)}`,
    ).expect(200);
    expect(page2.body.data.items).toHaveLength(10);
    const page1Ids = page1.body.data.items.map((item: { id: string }) => item.id);
    const page2Ids = page2.body.data.items.map((item: { id: string }) => item.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);

    // Prefix filter.
    const filtered = await authed(
      admin.cookies,
      'get',
      '/api/v1/admin/audit-logs?action=seed.*&limit=100',
    ).expect(200);
    expect(filtered.body.data.items).toHaveLength(25);
    expect(
      filtered.body.data.items.every((item: { action: string }) => item.action.startsWith('seed.')),
    ).toBe(true);

    // Entity filter.
    const entity = await authed(
      admin.cookies,
      'get',
      '/api/v1/admin/audit-logs?entityType=thing&entityId=t-3',
    ).expect(200);
    expect(entity.body.data.items).toHaveLength(1);
    expect(entity.body.data.items[0].entityId).toBe('t-3');
  });

  it('a failing audit write never fails the request', async () => {
    // Point the subscriber's AuditService at a throwing fake for one app.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .overrideProvider(SESSIONS_REPOSITORY)
      .useValue(sessionRepo)
      .overrideProvider(USERS_REPOSITORY)
      .useValue(userRepo)
      .overrideProvider((await import('../src/modules/audit/audit.service.js')).AuditService)
      .useValue({
        log: () => {
          throw new Error('audit down');
        },
        write: async () => {
          throw new Error('audit down');
        },
      })
      .compile();
    const failingApp = moduleRef.createNestApplication<NestExpressApplication>();
    const failingConfigured = failingApp as unknown as INestApplication;
    configureApp(failingApp);
    await failingConfigured.init();

    try {
      // Register works even though the audit write explodes.
      await request(failingConfigured.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: 'auditless_user', password: 'Sup3rSecret!' })
        .expect(201);
    } finally {
      await failingConfigured.close();
    }
  });
});
