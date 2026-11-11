import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AUDIT_SERVICE } from '../src/modules/audit/audit.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { NOTIFICATIONS_REPOSITORY } from '../src/modules/notifications/notifications.repository.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { NOTIFICATION_EVENT_DEFAULTS, NOTIFICATION_EVENT_KEYS } from '@app/contracts';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level notification tests (B5.3) WITHOUT live services: Redis is
 * FakeRedis, user/session repositories are in-memory fakes, the
 * notifications repository is an in-memory fake (the real SQL needs
 * Postgres — Docker follow-up). The REAL NotificationsService runs with
 * the real EmailService/SmsService (enqueue-only; QUEUES_SERVICE is a
 * capture fake) and the real I18nService (its DB lookup degrades to the
 * key-fallback contract — the translated texts are F5.3's UI concern).
 * Controllers, guards, envelope and the audit row run for real.
 */

function makeMemoryNotificationsRepo() {
  const events = new Map<
    string,
    { key: string; inApp: boolean; email: boolean; sms: boolean; push: boolean; isActive: boolean }
  >();
  const prefs = new Map<
    string,
    { userId: string; key: string; inApp: boolean; email: boolean; sms: boolean; push: boolean }
  >();
  const inbox: Array<{
    id: string;
    userId: string;
    key: string;
    payload: Record<string, string | number>;
    readAt: Date | null;
    createdAt: Date;
  }> = [];
  const contacts = new Map<
    string,
    { email: string | null; phone: string | null; locale: string | null }
  >();
  let seq = 0;
  return {
    events,
    prefs,
    inbox,
    contacts,
    async findEventRow(key: string) {
      return events.get(key) ?? null;
    },
    async listEventRows() {
      return [...events.values()];
    },
    async findPreferenceRow(userId: string, key: string) {
      return prefs.get(`${userId}:${key}`) ?? null;
    },
    async listPreferenceRows(userId: string) {
      return [...prefs.values()].filter((p) => p.userId === userId);
    },
    async upsertPreferenceRow(input: {
      userId: string;
      key: string;
      matrix: { inApp: boolean; email: boolean; sms: boolean; push: boolean };
    }) {
      prefs.set(`${input.userId}:${input.key}`, {
        userId: input.userId,
        key: input.key,
        ...input.matrix,
      });
    },
    async insertNotification(input: {
      userId: string;
      key: string;
      payload: Record<string, string | number>;
    }) {
      inbox.push({
        id: `d${String(++seq).padStart(7, '0')}-dddd-4ddd-8ddd-dddddddddddd`,
        userId: input.userId,
        key: input.key,
        payload: input.payload,
        readAt: null,
        createdAt: new Date(1_700_000_000_000 + inbox.length * 1_000),
      });
    },
    async listNotifications(userId: string, page: number, pageSize: number) {
      const rows = inbox
        .filter((n) => n.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
    },
    async unreadCount(userId: string) {
      return inbox.filter((n) => n.userId === userId && n.readAt === null).length;
    },
    async markRead(userId: string, ids: string[] | null) {
      let marked = 0;
      for (const n of inbox) {
        if (n.userId !== userId || n.readAt !== null) continue;
        if (ids === null || ids.includes(n.id)) {
          n.readAt = new Date();
          marked++;
        }
      }
      return marked;
    },
    async findUserContact(userId: string) {
      return contacts.get(userId) ?? null;
    },
  };
}

type NotificationsRepoFake = ReturnType<typeof makeMemoryNotificationsRepo>;

function makeFakeSettingsRepo() {
  const store = new Map<
    string,
    { key: string; value: unknown; isSecret: boolean; group: string }
  >();
  return {
    store,
    async findAll() {
      return [...store.values()].map((r) => ({ ...r, description: null }));
    },
    async findByKey(key: string) {
      const row = store.get(key);
      return row ? { ...row, description: null } : null;
    },
    async upsert(row: { key: string; value: unknown; isSecret: boolean; group: string }) {
      const created = { ...row, description: null, updatedAt: new Date() };
      store.set(row.key, created);
      return created;
    },
  };
}

let app: INestApplication;
let notificationsRepo: NotificationsRepoFake;
const auditActions: string[] = [];
let user: LoginSession;
let notificationsService: NotificationsService;
let userId = '';

beforeAll(async () => {
  const redis = new FakeRedis();
  notificationsRepo = makeMemoryNotificationsRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined), route: vi.fn() })
    .overrideProvider(NOTIFICATIONS_REPOSITORY)
    .useValue(notificationsRepo)
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .overrideProvider(AUDIT_SERVICE)
    .useValue({
      log: (entry: { action: string }) => {
        auditActions.push(entry.action);
      },
      write: vi.fn(async () => ({ id: 'audit-1' })),
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  const userRow = await createUser(app, { username: 'notifuser', password: 'Sup3rSecret!2026' });
  user = await loginAs(app, 'notifuser', 'Sup3rSecret!2026');
  userId = userRow.id;
  notificationsService = moduleRef.get(NotificationsService);
  // the contact the email/SMS channels resolve
  notificationsRepo.contacts.set(userId, {
    email: 'notif@test.dev',
    phone: '+989122222222',
    locale: 'fa',
  });
});

afterAll(async () => {
  await app?.close();
});

const getCatalog = () =>
  request(app.getHttpServer())
    .get('/api/v1/notifications/events')
    .set({ Authorization: user.bearer });

const getInbox = (query = '') =>
  request(app.getHttpServer())
    .get(`/api/v1/notifications/me/inbox${query}`)
    .set({ Authorization: user.bearer });

const getPreferences = () =>
  request(app.getHttpServer())
    .get('/api/v1/notifications/me/preferences')
    .set({ Authorization: user.bearer });

const putPreference = (body: object) =>
  request(app.getHttpServer())
    .put('/api/v1/notifications/me/preferences')
    .set({ Authorization: user.bearer })
    .send(body);

const markRead = (body: object) =>
  request(app.getHttpServer())
    .post('/api/v1/notifications/me/read')
    .set({ Authorization: user.bearer })
    .send(body);

describe('Notifications HTTP — B5.3', () => {
  it('401s every notifications route without a bearer', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/notifications/events')).status).toBe(
      401,
    );
    expect((await request(app.getHttpServer()).get('/api/v1/notifications/me/inbox')).status).toBe(
      401,
    );
    expect(
      (await request(app.getHttpServer()).get('/api/v1/notifications/me/preferences')).status,
    ).toBe(401);
    expect(
      (await request(app.getHttpServer()).put('/api/v1/notifications/me/preferences')).status,
    ).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/notifications/me/read')).status).toBe(
      401,
    );
  });

  it('GET /notifications/events serves the five-key catalog with defaults', async () => {
    const res = await getCatalog();
    expect(res.status).toBe(200);
    expect(res.body.data.events.map((e: { key: string }) => e.key).sort()).toEqual(
      [...NOTIFICATION_EVENT_KEYS].sort(),
    );
    for (const event of res.body.data.events) {
      expect(event.channels).toEqual(
        NOTIFICATION_EVENT_DEFAULTS[event.key as keyof typeof NOTIFICATION_EVENT_DEFAULTS],
      );
      expect(event.isActive).toBe(true);
    }
  });

  it('preferences: defaults → partial PUT merge → effective matrix back', async () => {
    const before = await getPreferences();
    expect(before.status).toBe(200);
    expect(before.body.data.preferences).toHaveLength(NOTIFICATION_EVENT_KEYS.length);
    expect(
      before.body.data.preferences.every((p: { overridden: boolean }) => p.overridden === false),
    ).toBe(true);

    const put = await putPreference({ eventKey: 'review.replied', channels: { sms: true } });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({
      eventKey: 'review.replied',
      channels: { inApp: true, email: true, sms: true, push: false },
      overridden: true,
    });

    const after = await getPreferences();
    const replied = after.body.data.preferences.find(
      (p: { eventKey: string }) => p.eventKey === 'review.replied',
    );
    expect(replied.overridden).toBe(true);
    expect(replied.channels.sms).toBe(true);
    // untouched events stay default
    const follow = after.body.data.preferences.find(
      (p: { eventKey: string }) => p.eventKey === 'follow.created',
    );
    expect(follow.overridden).toBe(false);
  });

  it('an unknown eventKey in the PUT body answers 400 (Zod)', async () => {
    const res = await putPreference({ eventKey: 'not.a.key', channels: { inApp: false } });
    expect(res.status).toBe(400);
  });

  it('notify → inbox (unread) → mark ids read → mark all read', async () => {
    // seed two notifications through the REAL service (fail-soft core)
    const first = await notificationsService.notify({
      userId,
      eventKey: 'question.answered',
      vars: { businessName: 'کافه نمونه', businessId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(first.delivered.inApp).toBe(true);
    await notificationsService.notify({
      userId,
      eventKey: 'follow.created',
      vars: { actor: 'سارا' },
    });

    const inbox = await getInbox('?page=1&pageSize=10');
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.meta).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    expect(inbox.body.data.unread).toBe(2);
    expect(inbox.body.data.items[0].eventKey).toBe('follow.created'); // newest first
    expect(inbox.body.data.items[0].payload).toEqual({ actor: 'سارا' });
    expect(inbox.body.data.items[0].readAt).toBeNull();

    // mark ONE read
    const firstId = inbox.body.data.items[0].id as string;
    const marked = await markRead({ ids: [firstId] });
    expect(marked.status).toBe(201); // Nest's POST default (action, not resource creation)
    expect(marked.body.data).toEqual({ marked: 1 });
    const afterOne = await getInbox();
    expect(afterOne.body.data.unread).toBe(1);
    expect(
      afterOne.body.data.items.find((i: { id: string }) => i.id === firstId).readAt,
    ).not.toBeNull();

    // mark ALL
    const all = await markRead({ all: true });
    expect(all.body.data).toEqual({ marked: 1 });
    const afterAll = await getInbox();
    expect(afterAll.body.data.unread).toBe(0);
  });

  it('mark-read validates its body: neither ids nor all → 400', async () => {
    const res = await markRead({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('the mark-read write is audited', async () => {
    expect(auditActions).toContain('notification.read');
  });
});
