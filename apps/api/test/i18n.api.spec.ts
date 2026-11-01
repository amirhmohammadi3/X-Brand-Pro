import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { REDIS } from '../src/redis/redis.client.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AppModule } from '../src/app.module.js';
import { seedI18nLanguages, seedI18nMessages } from '../src/db/seed/i18n.seed.js';
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

// The i18n suite runs against the real test database (mirrors audit.api.spec).
process.env.DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.TEST_DATABASE_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
process.env.PUBLIC_WEB_URL = 'http://localhost:3100';
if (!process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENCRYPTION_KEY.length < 32) {
  process.env.SETTINGS_ENCRYPTION_KEY = 'i18n-spec-key-0123456789abcdef-0123456789abcdef';
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
    console.warn('[i18n.api.spec] test database unavailable — suite skipped');
    return;
  }
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
  await prepareTestDatabase();
  await pool.query(
    'truncate table translations, languages, users, settings, media_files, otp_codes, sessions, oauth_accounts, audit_logs cascade',
  );
  await seedI18nLanguages(TEST_DB_URL!, () => undefined);
  await seedI18nMessages(TEST_DB_URL!, () => undefined);

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
    username: 'i18n-root',
    password: 'Sup3r-Secret!',
    email: 'i18n-root@example.com',
    role: 'super_admin',
  });
  await createUser(app, {
    username: 'i18n-user',
    password: 'Us3r-Secret!',
    email: 'i18n-user@example.com',
    role: 'user',
  });
  superAdmin = await loginAs(app, 'i18n-root', 'Sup3r-Secret!');
  plainUser = await loginAs(app, 'i18n-user', 'Us3r-Secret!');
}, 30_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  await pool?.query('delete from audit_logs');
});

// Real skip: no Postgres reachable ⇒ the whole suite skips (printed reason).
describe.skipIf(!databaseReachableSync())('i18n API (B1.12)', () => {
  it('permission matrix: admin endpoints are 401 anon, 403 user, 200 super_admin', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/i18n/languages').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/i18n/languages')
      .set('Authorization', plainUser.bearer)
      .expect(403);
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/i18n/languages')
      .set('Authorization', superAdmin.bearer)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.items.map((l: { code: string }) => l.code).sort()).toEqual(['en', 'fa']);
  });

  it('public languages lists active languages only with ETag', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/i18n/languages').expect(200);
    expect(res.body.data.items.map((l: { code: string }) => l.code).sort()).toEqual(['en', 'fa']);
    expect(res.headers.etag).toBeDefined();
  });

  it('messages/:locale returns the fa bundle; unknown locale is 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/i18n/messages/fa').expect(200);
    expect(res.body.locale).toBe('fa');
    expect(res.body.messages['errors.not_found']).toBeTruthy();
    expect(res.body.messages['common.save']).toBeTruthy();
    expect(res.body.version).toMatch(/^[0-9a-f]{12}$/);
    await request(app.getHttpServer()).get('/api/v1/i18n/messages/xx').expect(404);
  });

  it('ETag If-None-Match returns 304 with no body', async () => {
    const first = await request(app.getHttpServer()).get('/api/v1/i18n/messages/fa').expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeDefined();
    const second = await request(app.getHttpServer())
      .get('/api/v1/i18n/messages/fa')
      .set('If-None-Match', etag);
    expect(second.status).toBe(304);
    expect(second.text ?? '').toBe('');
  });

  it('created language starts inactive (messages 404) and activates via PATCH', async () => {
    const create = await authed(superAdmin.cookies, 'post', '/api/v1/admin/i18n/languages')
      .send({ code: 'ar', nameNative: 'العربية', nameEn: 'Arabic', dir: 'rtl', sortOrder: 10 })
      .expect(201);
    expect(create.body.data.isActive).toBe(false);

    await request(app.getHttpServer()).get('/api/v1/i18n/messages/ar').expect(404);

    await authed(superAdmin.cookies, 'patch', '/api/v1/admin/i18n/languages/ar')
      .send({ isActive: true })
      .expect(200);

    const bundle = await request(app.getHttpServer()).get('/api/v1/i18n/messages/ar').expect(200);
    // Fallback: ar has no translations yet — everything comes from fa.
    expect(bundle.body.messages['errors.not_found']).toBeTruthy();
  });

  it('upsert then bundle: new values appear, version changes, cache invalidated', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/i18n/messages/ar').expect(200);
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/i18n/translations')
      .send({
        locale: 'ar',
        entries: [
          { key: 'common.save', value: 'حفظ' },
          { key: 'common.loading', value: 'جار التحميل' },
        ],
      })
      .expect(200);
    const after = await request(app.getHttpServer()).get('/api/v1/i18n/messages/ar').expect(200);
    expect(after.body.messages['common.save']).toBe('حفظ');
    expect(after.body.messages['common.loading']).toBe('جار التحميل');
    // Filled from fa (unchanged):
    expect(after.body.messages['common.cancel']).toBe(before.body.messages['common.cancel']);
    expect(after.body.version).not.toBe(before.body.version);
  });

  it('HTML in values is rejected with 422; control chars are stripped', async () => {
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/i18n/translations')
      .send({ locale: 'ar', entries: [{ key: 'common.save', value: '<b>حفظ</b>' }] })
      .expect(422);
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/i18n/translations')
      .send({ locale: 'ar', entries: [{ key: 'common.delete', value: 'حذف\u0000x' }] })
      .expect(200);
    const bundle = await request(app.getHttpServer()).get('/api/v1/i18n/messages/ar').expect(200);
    expect(bundle.body.messages['common.delete']).toBe('حذفx');
  });

  it('default language rules: cannot deactivate default or fa; default switch is atomic', async () => {
    await authed(superAdmin.cookies, 'patch', '/api/v1/admin/i18n/languages/fa')
      .send({ isActive: false })
      .expect(422);
    await authed(superAdmin.cookies, 'delete', '/api/v1/admin/i18n/languages/fa').expect(422);

    // Make ar the default; previous default (fa) must be unset in the same transaction.
    await authed(superAdmin.cookies, 'patch', '/api/v1/admin/i18n/languages/ar')
      .send({ isDefault: true })
      .expect(200);
    const langs = await request(app.getHttpServer())
      .get('/api/v1/admin/i18n/languages')
      .set('Authorization', superAdmin.bearer)
      .expect(200);
    const defaults = langs.body.data.items.filter((l: { isDefault: boolean }) => l.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe('ar');

    // Restore fa as default for later tests.
    await authed(superAdmin.cookies, 'patch', '/api/v1/admin/i18n/languages/fa')
      .send({ isDefault: true, isActive: true })
      .expect(200);
  });

  it('admin translations list supports paging, namespace filter and missing=true', async () => {
    const page = await request(app.getHttpServer())
      .get('/api/v1/admin/i18n/translations?locale=ar&namespace=common&page=1&pageSize=5')
      .set('Authorization', superAdmin.bearer)
      .expect(200);
    expect(page.body.data.items.length).toBeGreaterThan(0);
    expect(page.body.data.items.length).toBeLessThanOrEqual(5);
    for (const item of page.body.data.items) {
      expect(item.key.startsWith('common.')).toBe(true);
    }

    const missing = await request(app.getHttpServer())
      .get('/api/v1/admin/i18n/translations?locale=ar&missing=true&page=1&pageSize=100')
      .set('Authorization', superAdmin.bearer)
      .expect(200);
    for (const item of missing.body.data.items) {
      expect(item.value).toBeNull();
      expect(item.defaultValue).toBeTruthy(); // reference value from the default locale
    }
    const keys: string[] = missing.body.data.items.map((i: { key: string }) => i.key);
    expect(keys).not.toContain('common.save'); // was upserted in an earlier test
    expect(keys).toContain('common.edit'); // never upserted → missing in ar
  });

  it('import: fill_missing inserts only absent keys; overwrite replaces existing', async () => {
    const fill = await authed(superAdmin.cookies, 'post', '/api/v1/admin/i18n/import')
      .send({
        locale: 'ar',
        mode: 'fill_missing',
        messages: {
          'common.edit': 'تحرير',
          'common.save': 'حفظ-جديد', // already present → skipped
        },
      })
      .expect(201);
    expect(fill.body.data).toEqual({ inserted: 1, updated: 0, skipped: 1 });

    const overwrite = await authed(superAdmin.cookies, 'post', '/api/v1/admin/i18n/import')
      .send({ locale: 'ar', mode: 'overwrite', messages: { 'common.edit': 'تعديل' } })
      .expect(201);
    expect(overwrite.body.data).toEqual({ inserted: 0, updated: 1, skipped: 0 });

    const bundle = await request(app.getHttpServer()).get('/api/v1/i18n/messages/ar').expect(200);
    expect(bundle.body.messages['common.edit']).toBe('تعديل');
  });

  it('export returns every default-locale key with "" for missing entries', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/i18n/export/ar')
      .set('Authorization', superAdmin.bearer)
      .expect(200);
    expect(res.headers['content-disposition']).toContain('attachment; filename="ar.json"');
    const messages = JSON.parse(res.text) as Record<string, string>;
    expect(messages['common.save']).toBe('حفظ');
    // A settings.* key (present in fa, never upserted to ar) exports as ''.
    const faBundle = await request(app.getHttpServer()).get('/api/v1/i18n/messages/fa').expect(200);
    const settingsKey = Object.keys(faBundle.body.messages).find((k) => k.startsWith('settings.'));
    expect(messages[settingsKey!]).toBe('');
  });

  it('seeder idempotency: re-running i18n-messages does not overwrite admin edits', async () => {
    const edited = 'ذخیره-ویرایش-شده';
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/i18n/translations')
      .send({ locale: 'fa', entries: [{ key: 'common.save', value: edited }] })
      .expect(200);
    await seedI18nMessages(TEST_DB_URL!, () => undefined);
    const bundle = await request(app.getHttpServer()).get('/api/v1/i18n/messages/fa').expect(200);
    expect(bundle.body.messages['common.save']).toBe(edited);
    // Restore the seed value for any later suites sharing the database.
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/i18n/translations')
      .send({ locale: 'fa', entries: [{ key: 'common.save', value: 'ذخیره' }] })
      .expect(200);
  });

  it('audit entries are written for admin i18n mutations', async () => {
    await authed(superAdmin.cookies, 'put', '/api/v1/admin/i18n/translations')
      .send({ locale: 'en', entries: [{ key: 'common.save', value: 'Save now' }] })
      .expect(200);
    const deadline = Date.now() + 3000;
    let actions: string[] = [];
    while (Date.now() < deadline) {
      const res = await pool!.query<{ action: string }>(
        "select action from audit_logs where action like 'i18n.%' order by created_at desc",
      );
      actions = res.rows.map((r) => r.action);
      if (actions.includes('i18n.translation.upsert')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(actions).toContain('i18n.translation.upsert');
  });
});
