import { describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import type {
  NotificationEventCatalogRow,
  NotificationPreferenceRowMeta,
  NotificationsRepositoryLike,
  NotificationRowMeta,
} from '../src/modules/notifications/notifications.repository.js';

/**
 * B5.3 NotificationsService — the fail-soft delivery core, DB-free: the
 * three-layer channel resolution (user preference → catalog row → code
 * defaults), the inactive-event silencing, the partial preference merge,
 * the per-channel try/catch isolation (a dead email/SMS channel reports
 * delivered:false and NEVER throws), the raw-var inbox payload and the
 * mark-read batching. The i18n rendering and the email/SMS ENQUEUE wiring
 * are exercised with capture doubles (the queue-backed delivery itself is
 * integration-tested against Docker per the Follow-up).
 */

const USER = '22222222-2222-4222-8222-222222222222';
const BIZ = '11111111-1111-4111-8111-111111111111';

/** In-memory repo mirroring the SQL semantics (incl. throwing modes). */
function makeRepo(opts: { failContact?: boolean; failInsert?: boolean } = {}) {
  const events = new Map<string, NotificationEventCatalogRow>();
  const prefs = new Map<string, NotificationPreferenceRowMeta>();
  const inbox: NotificationRowMeta[] = [];
  let seq = 0;
  const repo: NotificationsRepositoryLike = {
    async findEventRow(key) {
      return events.get(key) ?? null;
    },
    async listEventRows() {
      return [...events.values()];
    },
    async findPreferenceRow(userId, key) {
      return prefs.get(`${userId}:${key}`) ?? null;
    },
    async listPreferenceRows(userId) {
      return [...prefs.values()].filter((p) => p.userId === userId);
    },
    async upsertPreferenceRow(input) {
      prefs.set(`${input.userId}:${input.key}`, {
        userId: input.userId,
        key: input.key,
        ...input.matrix,
      });
    },
    async insertNotification(input) {
      if (opts.failInsert) throw new Error('db down');
      inbox.push({
        id: `c${String(++seq).padStart(7, '0')}-cccc-4ccc-8ccc-cccccccccccc`,
        userId: input.userId,
        key: input.key,
        payload: input.payload,
        readAt: null,
        createdAt: new Date(),
      });
    },
    async listNotifications(userId, page, pageSize) {
      const rows = inbox
        .filter((n) => n.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
    },
    async unreadCount(userId) {
      return inbox.filter((n) => n.userId === userId && n.readAt === null).length;
    },
    async markRead(userId, ids) {
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
    async findUserContact(userId) {
      if (opts.failContact) throw new Error('db down');
      if (userId !== USER) return null;
      return { email: 'user@test.dev', phone: '+989121111111', locale: 'fa' };
    },
  };
  return { repo, events, prefs, inbox };
}

/** Capture doubles for the enqueue-only channel services + i18n. */
function makeChannels(opts: { failEmail?: boolean; failSms?: boolean } = {}) {
  const emailCalls: Array<{
    to: string;
    template: string;
    locale: string;
    vars: Record<string, string>;
  }> = [];
  const smsCalls: Array<{ to: string; text: string }> = [];
  const i18nCalls: Array<{ locale: string; key: string }> = [];
  return {
    email: {
      async send(input: {
        to: string;
        template: string;
        locale: string;
        vars: Record<string, string>;
      }) {
        if (opts.failEmail) throw new Error('queue down');
        emailCalls.push(input);
        return { jobId: 'j1' };
      },
    } as never,
    sms: {
      async send(to: string, text: string) {
        if (opts.failSms) throw new Error('queue down');
        smsCalls.push({ to, text });
        return { jobId: 'j2' };
      },
    } as never,
    i18n: {
      async translate(locale: string, key: string, vars?: Record<string, string | number>) {
        i18nCalls.push({ locale, key });
        return `${key}|${Object.entries(vars ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`;
      },
    } as never,
    emailCalls,
    smsCalls,
    i18nCalls,
  };
}

function makeService(
  opts: {
    failContact?: boolean;
    failInsert?: boolean;
    failEmail?: boolean;
    failSms?: boolean;
  } = {},
) {
  const { repo, events, prefs, inbox } = makeRepo(opts);
  const channels = makeChannels(opts);
  const service = new NotificationsService(repo, channels.i18n, channels.email, channels.sms);
  return { service, repo, events, prefs, inbox, ...channels };
}

describe('NotificationsService — B5.3', () => {
  it('listCatalog merges DB rows over the code defaults (missing rows fall back)', async () => {
    const { service, events } = makeService();
    events.set('review.replied', {
      key: 'review.replied',
      inApp: true,
      email: true,
      sms: true,
      push: true,
      isActive: true,
    });
    const catalog = await service.listCatalog();
    expect(catalog.events).toHaveLength(5);
    const replied = catalog.events.find((e) => e.key === 'review.replied');
    expect(replied?.channels).toEqual({ inApp: true, email: true, sms: true, push: true });
    // untouched keys keep the shipped defaults
    const follow = catalog.events.find((e) => e.key === 'follow.created');
    expect(follow?.channels).toEqual({ inApp: true, email: false, sms: false, push: false });
    expect(follow?.isActive).toBe(true);
  });

  it('listPreferences marks overridden rows and fills the rest with defaults', async () => {
    const { service, prefs } = makeService();
    prefs.set(`${USER}:review.voted`, {
      userId: USER,
      key: 'review.voted',
      inApp: false,
      email: false,
      sms: false,
      push: false,
    });
    const result = await service.listPreferences(USER);
    expect(result.preferences).toHaveLength(5);
    const voted = result.preferences.find((p) => p.eventKey === 'review.voted');
    expect(voted?.overridden).toBe(true);
    expect(voted?.channels.inApp).toBe(false);
    const untouched = result.preferences.find((p) => p.eventKey === 'follow.created');
    expect(untouched?.overridden).toBe(false);
    expect(untouched?.channels).toEqual({ inApp: true, email: false, sms: false, push: false });
  });

  it('updatePreference merges the partial matrix over the effective one', async () => {
    const { service, prefs } = makeService();
    // no row yet → defaults: inApp true, email false
    const first = await service.updatePreference(USER, {
      eventKey: 'review.replied',
      channels: { email: true },
    });
    expect(first.channels).toEqual({ inApp: true, email: true, sms: false, push: false });
    // the row now exists → a second PUT merges over IT
    const second = await service.updatePreference(USER, {
      eventKey: 'review.replied',
      channels: { inApp: false },
    });
    expect(second.channels).toEqual({ inApp: false, email: true, sms: false, push: false });
    expect(prefs.size).toBe(1);
  });

  it('notify delivers in-app by default and stores the RAW vars', async () => {
    const { service, inbox } = makeService();
    const result = await service.notify({
      userId: USER,
      eventKey: 'question.answered',
      vars: { businessName: 'کافه نمونه', businessId: BIZ },
    });
    expect(result.delivered.inApp).toBe(true);
    expect(result.delivered.email).toBe(true); // question.answered default email=true + contact present
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      key: 'question.answered',
      payload: { businessName: 'کافه نمونه', businessId: BIZ },
      readAt: null,
    });
  });

  it('the email channel renders through i18n with the user locale and the generic template', async () => {
    const { service, emailCalls, i18nCalls } = makeService();
    await service.notify({
      userId: USER,
      eventKey: 'review.replied',
      vars: { actor: 'سارا', businessName: 'کافه نمونه' },
    });
    expect(i18nCalls).toContainEqual({ locale: 'fa', key: 'notifications.review.replied.title' });
    expect(i18nCalls).toContainEqual({ locale: 'fa', key: 'notifications.review.replied.body' });
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0]).toMatchObject({ to: 'user@test.dev', template: 'generic', locale: 'fa' });
    expect(emailCalls[0]?.vars.title).toContain('notifications.review.replied.title');
    expect(emailCalls[0]?.vars.body).toContain('actor=سارا');
  });

  it('the SMS channel sends the translated body when the matrix allows it', async () => {
    const { service, events, smsCalls } = makeService();
    events.set('follow.created', {
      key: 'follow.created',
      inApp: true,
      email: false,
      sms: true,
      push: false,
      isActive: true,
    });
    const result = await service.notify({
      userId: USER,
      eventKey: 'follow.created',
      vars: { actor: 'علی' },
    });
    expect(result.delivered.sms).toBe(true);
    expect(smsCalls).toHaveLength(1);
    expect(smsCalls[0]?.to).toBe('+989121111111');
    expect(smsCalls[0]?.text).toContain('notifications.follow.created.body');
  });

  it('a disabled channel or missing contact skips delivery silently', async () => {
    const { service, emailCalls, smsCalls } = makeService();
    // follow.created default: email off, sms off
    const result = await service.notify({ userId: USER, eventKey: 'follow.created', vars: {} });
    expect(result.channels.email).toBe(false);
    expect(emailCalls).toHaveLength(0);
    expect(smsCalls).toHaveLength(0);
    // unknown user → no contact → email (default-on for question.answered) reports false
    const strangerResult = await service.notify({
      userId: '91919191-9191-4919-8919-919191919191',
      eventKey: 'question.answered',
      vars: {},
    });
    expect(strangerResult.delivered.email).toBe(false);
  });

  it('fail-soft: repo/contact/queue failures report delivered:false and never throw', async () => {
    const failing = makeService({ failContact: true, failInsert: true, failEmail: true });
    const result = await failing.service.notify({
      userId: USER,
      eventKey: 'question.answered',
      vars: {},
    });
    expect(result.delivered.inApp).toBe(false);
    expect(result.delivered.email).toBe(false);
    expect(result.delivered.sms).toBe(false);
    expect(result.delivered.push).toBe(false);
    // catalog/preference reads also degrade to defaults
    const catalog = await failing.service.listCatalog();
    expect(catalog.events.every((e) => e.channels.inApp === true)).toBe(true);
  });

  it('an inactive catalog row silences the event globally (all channels off)', async () => {
    const { service, events } = makeService();
    events.set('review.replied', {
      key: 'review.replied',
      inApp: true,
      email: true,
      sms: false,
      push: false,
      isActive: false,
    });
    const result = await service.notify({ userId: USER, eventKey: 'review.replied', vars: {} });
    expect(result.channels).toEqual({ inApp: false, email: false, sms: false, push: false });
    expect(result.delivered).toEqual({ inApp: false, email: false, sms: false, push: false });
  });

  it('an unknown event key is a no-op result, never a throw', async () => {
    const { service } = makeService();
    const result = await service.notify({
      userId: USER,
      eventKey: 'not.a.key' as never,
      vars: {},
    });
    expect(result.delivered).toEqual({ inApp: false, email: false, sms: false, push: false });
  });

  it('inbox pages newest-first with the unread total, and markRead batches', async () => {
    const { service } = makeService();
    for (let i = 0; i < 3; i++) {
      await service.notify({ userId: USER, eventKey: 'review.voted', vars: { n: i } });
    }
    const page1 = await service.listInbox(USER, { page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page1.unread).toBe(3);
    const ids = page1.items.map((i) => i.id);
    const marked = await service.markRead(USER, { ids });
    expect(marked).toEqual({ marked: 2 });
    const after = await service.listInbox(USER, { page: 1, pageSize: 20 });
    expect(after.unread).toBe(1);
    const all = await service.markRead(USER, { all: true });
    expect(all).toEqual({ marked: 1 });
    const empty = await service.listInbox(USER, { page: 1, pageSize: 20 });
    expect(empty.unread).toBe(0);
    expect(empty.items.every((i) => i.readAt !== null)).toBe(true);
  });

  it('the push channel (B5.4) delivers through the PUSH_SENDER contract and reports the outcome', async () => {
    const { service, events } = makeService();
    events.set('review.voted', {
      key: 'review.voted',
      inApp: false,
      email: false,
      sms: false,
      push: true,
      isActive: true,
    });
    // a sender bound like the module wires it (useExisting PushService)
    const sent: Array<{ userId: string; eventKey: string; locale: string }> = [];
    (service as unknown as { pushSender?: unknown }).pushSender = {
      async sendToUser(input: { userId: string; eventKey: string; locale: string }) {
        sent.push(input);
        return true;
      },
    };
    const result = await service.notify({ userId: USER, eventKey: 'review.voted', vars: {} });
    expect(result.delivered.push).toBe(true);
    expect(result.delivered.inApp).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: USER, eventKey: 'review.voted', locale: 'fa' });
    // a throwing sender degrades to delivered:false (fail-soft holds)
    (service as unknown as { pushSender?: unknown }).pushSender = {
      async sendToUser() {
        throw new Error('push down');
      },
    };
    const failed = await service.notify({ userId: USER, eventKey: 'review.voted', vars: {} });
    expect(failed.delivered.push).toBe(false);
  });
});
