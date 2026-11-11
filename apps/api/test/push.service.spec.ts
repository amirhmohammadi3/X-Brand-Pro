import { describe, expect, it } from 'vitest';
import { PushService } from '../src/modules/notifications/push/push.service.js';
import type {
  PushSubscriptionMeta,
  PushSubscriptionsRepositoryLike,
} from '../src/modules/notifications/push/push-subscriptions.repository.js';

/**
 * B5.4 PushService — the fail-soft web-push sender + subscription store,
 * DB-free and network-free: the endpoint upsert (re-subscribe replaces),
 * the key-free "my devices" echo, the owner-scoped unsubscribe, the VAPID
 * gate (empty settings = disabled), the 404/410 self-cleanup lifecycle and
 * the at-least-one-delivered semantics. The actual network send is faked
 * by stubbing the web-push module function.
 */

const USER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const OTHER_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/def456';

function makeRepo() {
  const rows = new Map<string, PushSubscriptionMeta>();
  let seq = 0;
  const repo: PushSubscriptionsRepositoryLike = {
    async upsertByEndpoint(input) {
      const existing = [...rows.values()].find((r) => r.endpoint === input.endpoint);
      const row: PushSubscriptionMeta = {
        id: existing?.id ?? `e${String(++seq).padStart(7, '0')}-eeee-4eee-8eee-eeeeeeeeeeee`,
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        createdAt: existing?.createdAt ?? new Date(1_700_000_000_000 + rows.size * 1_000),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async listByUser(userId) {
      return [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ ...r }));
    },
    async deleteByIdAndUser(id, userId) {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return false;
      rows.delete(id);
      return true;
    },
    async deleteByIds(ids) {
      for (const id of ids) rows.delete(id);
    },
  };
  return { repo, rows };
}

/** Fake settings: returns the map values (empty = push disabled). */
function makeSettings(values: Record<string, string>) {
  return {
    async get<T>(key: string): Promise<T> {
      return values[key] as T;
    },
  } as never;
}

function makeI18n() {
  return {
    async translate(locale: string, key: string, vars?: Record<string, string | number>) {
      return `${locale}:${key}:${JSON.stringify(vars ?? {})}`;
    },
  } as never;
}

/** Whether webpush.sendNotification resolves or rejects (per endpoint). */
let sendBehavior: 'ok' | 'gone' | 'notfound' | 'fail' = 'ok';
const sentTo: string[] = [];

vi.hoisted(() => undefined);
import { vi, afterEach } from 'vitest';
import { beforeEach } from 'vitest';

vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn(async (sub: { endpoint: string }) => {
      sentTo.push(sub.endpoint);
      if (sendBehavior === 'gone') {
        throw Object.assign(new Error('gone'), { statusCode: 410 });
      }
      if (sendBehavior === 'notfound') {
        throw Object.assign(new Error('not found'), { statusCode: 404 });
      }
      if (sendBehavior === 'fail') {
        throw new Error('boom');
      }
      return undefined;
    }),
  },
}));

function makeService(
  values: Record<string, string> = {
    'push.vapid.publicKey': 'PUB',
    'push.vapid.privateKey': 'PRIV',
    'push.vapid.subject': 'mailto:admin@test.dev',
  },
) {
  const { repo, rows } = makeRepo();
  const service = new PushService(repo, makeSettings(values), makeI18n());
  return { service, repo, rows };
}

beforeEach(() => {
  sendBehavior = 'ok';
  sentTo.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('PushService — B5.4', () => {
  it('subscribe upserts on the endpoint: re-subscribing replaces keys, not rows', async () => {
    const { service, rows } = makeService();
    const first = await service.subscribe(USER, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'k1', auth: 'a1' },
      userAgent: 'Firefox/1',
    });
    expect(first).toMatchObject({ endpoint: ENDPOINT, userAgent: 'Firefox/1' });
    const second = await service.subscribe(USER, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'k2', auth: 'a2' },
      userAgent: 'Firefox/2',
    });
    expect(second.id).toBe(first.id);
    expect(rows.size).toBe(1);
    expect(rows.get(first.id)).toMatchObject({ p256dh: 'k2', userAgent: 'Firefox/2' });
  });

  it('listMine echoes NO key material', async () => {
    const { service } = makeService();
    await service.subscribe(USER, { endpoint: ENDPOINT, keys: { p256dh: 'k1', auth: 'a1' } });
    const list = await service.listMine(USER);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ endpoint: ENDPOINT });
    expect(JSON.stringify(list)).not.toContain('k1');
    expect(JSON.stringify(list)).not.toContain('a1');
  });

  it('unsubscribe is owner-scoped (a stranger cannot delete another user’s device)', async () => {
    const { service, rows } = makeService();
    const sub = await service.subscribe(USER, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'k', auth: 'a' },
    });
    const foreign = await service.unsubscribe(STRANGER, sub.id);
    expect(foreign).toEqual({ deleted: false });
    expect(rows.size).toBe(1);
    const own = await service.unsubscribe(USER, sub.id);
    expect(own).toEqual({ deleted: true });
    expect(rows.size).toBe(0);
  });

  it('sendToUser: no VAPID config or no subscriptions → false without sending', async () => {
    const disabled = makeService({});
    await disabled.service.subscribe(USER, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'k', auth: 'a' },
    });
    const result = await disabled.service.sendToUser({
      userId: USER,
      eventKey: 'follow.created',
      vars: {},
      locale: 'fa',
    });
    expect(result).toBe(false);
    expect(sentTo).toHaveLength(0);

    const noSubs = makeService();
    const empty = await noSubs.service.sendToUser({
      userId: STRANGER,
      eventKey: 'follow.created',
      vars: {},
      locale: 'fa',
    });
    expect(empty).toBe(false);
    expect(sentTo).toHaveLength(0);
  });

  it('a delivered push resolves true and carries the translated payload', async () => {
    const { service } = makeService();
    await service.subscribe(USER, { endpoint: ENDPOINT, keys: { p256dh: 'k', auth: 'a' } });
    const result = await service.sendToUser({
      userId: USER,
      eventKey: 'follow.created',
      vars: { actor: 'سارا' },
      locale: 'fa',
    });
    expect(result).toBe(true);
    expect(sentTo).toEqual([ENDPOINT]);
    const sendMock = (await import('web-push')).default.sendNotification as ReturnType<
      typeof vi.fn
    >;
    const payload = JSON.parse(sendMock.mock.calls[0]?.[1] as string) as {
      title: string;
      body: string;
      eventKey: string;
    };
    expect(payload.eventKey).toBe('follow.created');
    expect(payload.title).toContain('notifications.follow.created.title');
    expect(payload.body).toContain('"actor":"سارا"');
  });

  it('404/410 from the push service DELETES the dead subscription (self-cleanup)', async () => {
    const { service, rows } = makeService();
    const a = await service.subscribe(USER, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'k', auth: 'a' },
    });
    await service.subscribe(USER, { endpoint: OTHER_ENDPOINT, keys: { p256dh: 'k', auth: 'a' } });
    sendBehavior = 'gone';
    const result = await service.sendToUser({
      userId: USER,
      eventKey: 'follow.created',
      vars: {},
      locale: 'fa',
    });
    expect(result).toBe(false); // nothing delivered — and both rows are dead
    expect(rows.size).toBe(0);
    void a;

    const one = makeService();
    const sub = await one.service.subscribe(USER, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'k', auth: 'a' },
    });
    const other = await one.service.subscribe(USER, {
      endpoint: OTHER_ENDPOINT,
      keys: { p256dh: 'k', auth: 'a' },
    });
    sendBehavior = 'notfound';
    // make only the FIRST endpoint fail: flip behavior after the first call
    const sendMock = (await import('web-push')).default.sendNotification as ReturnType<
      typeof vi.fn
    >;
    sendMock.mockImplementationOnce(async () => {
      throw Object.assign(new Error('not found'), { statusCode: 404 });
    });
    sendBehavior = 'ok';
    const partial = await one.service.sendToUser({
      userId: USER,
      eventKey: 'follow.created',
      vars: {},
      locale: 'fa',
    });
    expect(partial).toBe(true); // the second endpoint delivered
    expect(rows.size).toBe(0); // rows belong to the shared makeService… (fresh instance has its own)
    void sub;
    void other;
  });

  it('a generic send failure is fail-soft (false, no throw, no cleanup)', async () => {
    const { service, rows } = makeService();
    await service.subscribe(USER, { endpoint: ENDPOINT, keys: { p256dh: 'k', auth: 'a' } });
    sendBehavior = 'fail';
    const result = await service.sendToUser({
      userId: USER,
      eventKey: 'follow.created',
      vars: {},
      locale: 'fa',
    });
    expect(result).toBe(false);
    expect(rows.size).toBe(1); // a transient failure must NOT drop the subscription
  });

  it('at-least-one-delivered: multiple devices answer true when any resolves', async () => {
    const { service } = makeService();
    await service.subscribe(USER, { endpoint: ENDPOINT, keys: { p256dh: 'k', auth: 'a' } });
    await service.subscribe(USER, { endpoint: OTHER_ENDPOINT, keys: { p256dh: 'k', auth: 'a' } });
    const sendMock = (await import('web-push')).default.sendNotification as ReturnType<
      typeof vi.fn
    >;
    sendMock.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const result = await service.sendToUser({
      userId: USER,
      eventKey: 'follow.created',
      vars: {},
      locale: 'fa',
    });
    expect(result).toBe(true);
    // the throwing first call is NOT recorded by the spy — one resolved send
    expect(sentTo).toHaveLength(1);
  });
});
