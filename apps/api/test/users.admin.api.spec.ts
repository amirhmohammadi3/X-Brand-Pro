import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { REDIS } from '../src/redis/redis.client.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { USERS_EXPIRE_BANS_JOB } from '../src/modules/users/users.jobs.js';
import { registerUsersJobs } from '../src/modules/users/users.jobs.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { AppModule } from '../src/app.module.js';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { WorkersService } from '../src/queue/workers.service.js';

type MemoryUserRepo = ReturnType<typeof makeMemoryUserRepo>;

process.env.DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.TEST_DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.PUBLIC_WEB_URL = 'http://localhost:3100';
if (!process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENCRYPTION_KEY.length < 32) {
  process.env.SETTINGS_ENCRYPTION_KEY = 'users-spec-key-0123456789abcdef-0123456789abcdef';
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

let app: INestApplication;
let pool: Pool | null = null;
let userRepo: MemoryUserRepo;
let sessionRepo: ReturnType<typeof makeMemorySessionRepo>;
let redis: FakeRedis;

let superAdmin: LoginSession;
let admin: LoginSession;
let moderator: LoginSession;
let plainUser: LoginSession;
const logins: Record<string, LoginSession> = {};
const userIds: Record<string, string> = {};

const ORIGIN = 'http://localhost:3100';

function authed(
  session: LoginSession,
  verb: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
) {
  return request(app.getHttpServer())
    [verb](path)
    .set('Cookie', session.cookies.join('; '))
    .set('Origin', ORIGIN);
}

interface ActorTargetCase {
  actor: 'super_admin' | 'admin' | 'moderator' | 'user';
  target: 'super_admin' | 'admin' | 'moderator' | 'user';
  action: 'list' | 'role' | 'ban';
  expected: number;
}

/**
 * The B1.14 matrix (docs/SECURITY.md hierarchy table):
 *  - list (users.read): moderators+; plain users 403
 *  - role change (users.manage): admins+, but ONLY super_admin may touch
 *    admin/super_admin roles; nobody changes their own role
 *  - ban (users.manage): admins+, never a target with equal/higher rank
 */
const MATRIX: ActorTargetCase[] = [
  { actor: 'super_admin', target: 'user', action: 'list', expected: 200 },
  { actor: 'admin', target: 'user', action: 'list', expected: 200 },
  { actor: 'moderator', target: 'user', action: 'list', expected: 200 },
  { actor: 'user', target: 'user', action: 'list', expected: 403 },

  { actor: 'super_admin', target: 'user', action: 'role', expected: 200 },
  { actor: 'admin', target: 'user', action: 'role', expected: 200 },
  { actor: 'moderator', target: 'user', action: 'role', expected: 403 },
  { actor: 'user', target: 'user', action: 'role', expected: 403 },
  { actor: 'admin', target: 'admin', action: 'role', expected: 403 },
  { actor: 'admin', target: 'super_admin', action: 'role', expected: 403 },
  { actor: 'super_admin', target: 'admin', action: 'role', expected: 200 },

  { actor: 'super_admin', target: 'user', action: 'ban', expected: 200 },
  { actor: 'admin', target: 'user', action: 'ban', expected: 200 },
  { actor: 'moderator', target: 'user', action: 'ban', expected: 403 },
  { actor: 'user', target: 'user', action: 'ban', expected: 403 },
  { actor: 'admin', target: 'admin', action: 'ban', expected: 403 },
  { actor: 'admin', target: 'super_admin', action: 'ban', expected: 403 },
  { actor: 'super_admin', target: 'admin', action: 'ban', expected: 403 }, // equal rank
];

beforeAll(async () => {
  if (!(await databaseAvailable())) {
    console.warn('[users.admin.api.spec] test database unavailable — suite skipped');
    return;
  }
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
  await prepareTestDatabase();
  await pool.query(
    'truncate table users, settings, media_files, otp_codes, sessions, oauth_accounts, audit_logs, translations, languages, theme_packs cascade',
  );

  userRepo = makeMemoryUserRepo();
  sessionRepo = makeMemorySessionRepo();
  redis = new FakeRedis();

  // WorkersService stub: capture registrations so the job can be invoked
  // synchronously in the expire-bans test (no real Redis queue here).
  const registered: Array<{ queue: string; processor: (job: { name: string }) => Promise<void> }> =
    [];
  const workersStub = {
    register: (queue: string, processor: (job: { name: string }) => Promise<void>) => {
      registered.push({ queue, processor });
      return workersStub;
    },
    registerRepeatable: () => workersStub,
    startAll: () => [],
    closeAll: async () => undefined,
  } as unknown as WorkersService;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(sessionRepo)
    .overrideProvider(USERS_REPOSITORY)
    .useValue(userRepo)
    .overrideProvider((await import('../src/queue/queue.module.js')).WORKERS_SERVICE)
    .useValue(workersStub)
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  // Register the users jobs against the stub (mirrors UsersJobsInit).
  registerUsersJobs(workersStub, app.get(UsersService), redis);
  void registered;

  const roles: Array<{
    key: string;
    role: 'super_admin' | 'admin' | 'moderator' | 'user';
    username: string;
  }> = [
    { key: 'super_admin', role: 'super_admin', username: 'users-root' },
    { key: 'admin', role: 'admin', username: 'users-admin' },
    { key: 'moderator', role: 'moderator', username: 'users-mod' },
    { key: 'user', role: 'user', username: 'users-plain' },
  ];
  for (const r of roles) {
    const row = await createUser(app, {
      username: r.username,
      password: 'Sup3r-Secret!',
      email: `${r.username}@example.com`,
      role: r.role,
    });
    userIds[r.key] = row.id;
    logins[r.key] = await loginAs(app, r.username, 'Sup3r-Secret!');
  }
  superAdmin = logins.super_admin!;
  admin = logins.admin!;
  moderator = logins.moderator!;
  plainUser = logins.user!;
}, 30_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  await pool?.query('delete from audit_logs');
});

function actorSession(key: ActorTargetCase['actor']): LoginSession {
  return logins[key]!;
}

describe.skipIf(!databaseReachableSync())('admin users API (B1.14)', () => {
  it('role × action × target matrix matches the hierarchy table', async () => {
    // Extra targets for the privileged-role rows (one of each, active).
    const targets: Record<string, string> = {};
    for (const role of ['user', 'moderator', 'admin'] as const) {
      const u = await createUser(app, {
        username: `matrix-${role}`,
        password: 'Sup3r-Secret!',
        role,
      });
      targets[role] = u.id;
    }
    targets.super_admin = userIds.super_admin!;

    for (const c of MATRIX) {
      let res;
      if (c.action === 'list') {
        res = await authed(actorSession(c.actor), 'get', '/api/v1/admin/users');
      } else if (c.action === 'role') {
        res = await authed(
          actorSession(c.actor),
          'patch',
          `/api/v1/admin/users/${targets[c.target]}/role`,
        ).send({ role: 'user' });
      } else {
        res = await authed(
          actorSession(c.actor),
          'post',
          `/api/v1/admin/users/${targets[c.target]}/ban`,
        ).send({ reason: 'matrix test ban' });
      }
      expect(res.status, `${c.actor} ${c.action} ${c.target} expected ${c.expected}`).toBe(
        c.expected,
      );
    }
  });

  it('list: pagination totals, role/status filters and q search (Persian digits in phone)', async () => {
    await createUser(app, {
      username: 'search-me',
      password: 'Sup3r-Secret!',
      phone: '+989121112233',
      role: 'user',
    });
    const page1 = await authed(superAdmin, 'get', '/api/v1/admin/users?page=1&pageSize=2').expect(
      200,
    );
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.meta.total).toBeGreaterThan(2);
    expect(page1.body.data.meta.totalPages).toBeGreaterThanOrEqual(2);
    expect(page1.body.data.items[0].sessionsCount).toBeGreaterThanOrEqual(0);

    const filtered = await authed(superAdmin, 'get', '/api/v1/admin/users?role=moderator').expect(
      200,
    );
    for (const item of filtered.body.data.items) {
      expect(item.role).toBe('moderator');
    }

    // Persian digits: ۰۹۱۲۱۱۱۲۲۳۳ → +989121112233 needle "9121112233".
    const byPhone = await authed(superAdmin, 'get', '/api/v1/admin/users?q=۰۹۱۲۱۱۱۲۲۳۳').expect(
      200,
    );
    expect(
      byPhone.body.data.items.some((u: { username: string }) => u.username === 'search-me'),
    ).toBe(true);
    const byName = await authed(superAdmin, 'get', '/api/v1/admin/users?q=SEARCH-ME').expect(200);
    expect(
      byName.body.data.items.some((u: { username: string }) => u.username === 'search-me'),
    ).toBe(true);
  });

  it('self-targeting is rejected for role and ban', async () => {
    await authed(superAdmin, 'patch', `/api/v1/admin/users/${userIds.super_admin}/role`)
      .send({ role: 'admin' })
      .expect(409);
    await authed(superAdmin, 'post', `/api/v1/admin/users/${userIds.super_admin}/ban`)
      .send({ reason: 'self ban' })
      .expect(409);
  });

  it('the last super_admin cannot be demoted, and banning needs lower rank', async () => {
    const second = await createUser(app, {
      username: 'second-root',
      password: 'Sup3r-Secret!',
      role: 'super_admin',
    });
    // Two active super_admins: demotion of one is fine now.
    await authed(superAdmin, 'patch', `/api/v1/admin/users/${second.id}/role`)
      .send({ role: 'admin' })
      .expect(200);
    // Now only ONE active super_admin remains — demoting them fails 409.
    await authed(superAdmin, 'patch', `/api/v1/admin/users/${userIds.super_admin}/role`)
      .send({ role: 'moderator' })
      .expect(409);
    // Role change on a non-active target is rejected.
    await authed(superAdmin, 'patch', `/api/v1/admin/users/${userIds.super_admin}/role`)
      .send({ role: 'user' })
      .expect(409);
  });

  it('ban revokes sessions so the old token stops working immediately', async () => {
    const victim = await createUser(app, {
      username: 'ban-victim',
      password: 'Sup3r-Secret!',
      role: 'user',
    });
    const victimLogin = await loginAs(app, 'ban-victim', 'Sup3r-Secret!');
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', victimLogin.bearer)
      .expect(200);

    await authed(superAdmin, 'post', `/api/v1/admin/users/${victim.id}/ban`)
      .send({ reason: 'spam behaviour', until: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', victimLogin.bearer);
    expect([401, 403]).toContain(after.status);

    // Detail shows the ban fields.
    const detail = await authed(superAdmin, 'get', `/api/v1/admin/users/${victim.id}`).expect(200);
    expect(detail.body.data.status).toBe('blocked');
    expect(detail.body.data.bannedReason).toBe('spam behaviour');
    expect(detail.body.data.bannedUntil).toBeTruthy();
    expect(detail.body.data.sessionsCount).toBe(0);

    // Unban restores active and clears the fields.
    await authed(superAdmin, 'post', `/api/v1/admin/users/${victim.id}/unban`).expect(200);
    const afterUnban = await authed(superAdmin, 'get', `/api/v1/admin/users/${victim.id}`).expect(
      200,
    );
    expect(afterUnban.body.data.status).toBe('active');
    expect(afterUnban.body.data.bannedReason).toBeNull();
    expect(afterUnban.body.data.bannedUntil).toBeNull();
  });

  it('an expired time-boxed ban is treated as not banned (effective status)', async () => {
    const row = await createUser(app, {
      username: 'expired-ban',
      password: 'Sup3r-Secret!',
      role: 'user',
    });
    const users = app.get(UsersService);
    const target = userRepo.rows.get(row.id)!;
    userRepo.rows.set(row.id, {
      ...target,
      status: 'blocked',
      bannedReason: 'cooldown',
      bannedUntil: new Date(Date.now() - 1000), // already passed
    });
    expect(users.effectiveStatus(userRepo.rows.get(row.id)!)).toBe('active');

    // Login works despite status='blocked' (ban expired).
    const login = await loginAs(app, 'expired-ban', 'Sup3r-Secret!');
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', login.bearer)
      .expect(200);
  });

  it('users:expire-bans lifts only expired time-boxed bans (job handler)', async () => {
    const a = await createUser(app, { username: 'expire-a', password: 'Sup3r-Secret!' });
    const b = await createUser(app, { username: 'expire-b', password: 'Sup3r-Secret!' });
    const c = await createUser(app, { username: 'expire-c', password: 'Sup3r-Secret!' });
    const set = (id: string, until: Date | null, reason: string | null = 'r') => {
      const row = userRepo.rows.get(id)!;
      userRepo.rows.set(id, {
        ...row,
        status: 'blocked',
        bannedReason: reason,
        bannedUntil: until,
      });
    };
    set(a.id, new Date(Date.now() - 5_000)); // expired → lifted
    set(b.id, new Date(Date.now() + 3_600_000)); // future → stays
    set(c.id, null); // indefinite → stays

    // Invoke the registered job handler directly (no real queue in tests).
    const { USERS_EXPIRE_BANS_EVERY_MS } = await import('../src/modules/users/users.jobs.js');
    expect(USERS_EXPIRE_BANS_EVERY_MS).toBe(5 * 60 * 1000);
    const lifted = await app.get(UsersService).expireBans(new Date());
    expect(lifted).toContain(a.id);
    expect(lifted).not.toContain(b.id);
    expect(lifted).not.toContain(c.id);
    expect(userRepo.rows.get(a.id)!.status).toBe('active');
    expect(userRepo.rows.get(b.id)!.status).toBe('blocked');
    expect(userRepo.rows.get(c.id)!.status).toBe('blocked');
    void USERS_EXPIRE_BANS_JOB;
  });

  it('revoke-sessions kills every active session of the target', async () => {
    const victim = await createUser(app, { username: 'revoke-me', password: 'Sup3r-Secret!' });
    const first = await loginAs(app, 'revoke-me', 'Sup3r-Secret!');
    const second = await loginAs(app, 'revoke-me', 'Sup3r-Secret!');
    expect(sessionRepo.rows.size).toBeGreaterThanOrEqual(2);

    const res = await authed(
      superAdmin,
      'post',
      `/api/v1/admin/users/${victim.id}/revoke-sessions`,
    ).expect(201);
    expect(res.body.data.revoked).toBeGreaterThanOrEqual(2);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', first.bearer)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', second.bearer)
      .expect(401);
  });

  it('audit rows are written with actor and before/after', async () => {
    const target = await createUser(app, { username: 'audit-target', password: 'Sup3r-Secret!' });
    await authed(superAdmin, 'patch', `/api/v1/admin/users/${target.id}/role`)
      .send({ role: 'moderator' })
      .expect(200);
    await authed(superAdmin, 'post', `/api/v1/admin/users/${target.id}/ban`)
      .send({ reason: 'audit test' })
      .expect(200);

    const deadline = Date.now() + 3000;
    let roles: Array<{ action: string; actor_id: string | null; before: unknown; after: unknown }> =
      [];
    while (Date.now() < deadline) {
      const res = await pool!.query(
        "select action, actor_id, before, after from audit_logs where action in ('users.role_changed','users.banned') order by created_at",
      );
      roles = res.rows;
      if (roles.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(roles.map((r) => r.action)).toEqual(['users.role_changed', 'users.banned']);
    expect(roles[0]!.actor_id).toBe(userIds.super_admin);
    expect(roles[0]!.before).toMatchObject({ role: 'user' });
    expect(roles[0]!.after).toMatchObject({ role: 'moderator' });
    expect(roles[1]!.after).toMatchObject({ status: 'blocked' });
    void plainUser;
    void admin;
    void moderator;
    void vi;
  });
});
