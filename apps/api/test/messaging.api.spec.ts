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
import { BUSINESSES_REPOSITORY } from '../src/modules/business/businesses.repository.js';
import { MEDIA_SERVICE } from '../src/modules/media/media.service.js';
import { MESSAGING_REPOSITORY } from '../src/modules/messaging/messaging.repository.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level messaging tests (B5.6) WITHOUT live services: Redis is
 * FakeRedis, user/session repositories are in-memory fakes, the messaging
 * repository is an in-memory fake (the real SQL needs Postgres — Docker
 * follow-up), MEDIA_SERVICE is a markAttached recorder, the businesses
 * repository is an empty card fake (the realtime gateway's constructor
 * needs the token present). Everything else — controllers, guards
 * (RateLimit → JwtAuth → CsrfOrigin), envelope, the REAL EventEmitter2,
 * the REAL RealtimeMessagingSubscriber wiring — runs for real.
 */

const MY_MEDIA = '44444444-4444-4444-8444-444444444444';
const FOREIGN_MEDIA = '45454545-4545-4545-8545-454545454545';
const WRONG_KIND_MEDIA = '46464646-4646-4646-8646-464646464646';

interface ConversationState {
  id: string;
  pairKey: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  participants: string[];
  lastReadAt: Map<string, Date | null>;
}
interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  attachmentMediaId: string | null;
}

/** In-memory messaging repo (same SQL semantics the real one implements). */
function makeMemoryMessagingRepo() {
  const usersCtx = new Map<string, { status: string }>();
  const conversations = new Map<string, ConversationState>();
  const messages = new Map<string, MessageRow>();
  const blocks = new Map<string, Date>();
  const reports: Array<{ id: string; messageId: string; reporterId: string }> = [];
  const media = new Map<
    string,
    {
      id: string;
      kind: string;
      mime: string;
      sizeBytes: number;
      key: string;
      thumbKey: string | null;
      ownerUserId: string | null;
      deletedAt: Date | null;
    }
  >();
  const attached: string[] = [];

  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `b${String(seq).padStart(7, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
  };
  let clock = new Date('2026-11-12T10:00:00.000Z');
  const tick = (ms = 1000) => {
    clock = new Date(clock.getTime() + ms);
    return new Date(clock);
  };

  const repo = {
    async findUserContext(userId: string) {
      return usersCtx.get(userId) ?? null;
    },
    async findUserCards(userIds: string[]) {
      return userIds
        .filter((id) => usersCtx.get(id)?.status === 'active')
        .map((id) => ({
          id,
          username: `user-${id.slice(0, 4)}`,
          displayName: null,
          avatarMediaKey: null,
          avatarMediaThumbKey: null,
        }));
    },
    async findConversationByPairKey(pairKey: string) {
      for (const c of conversations.values()) if (c.pairKey === pairKey) return { id: c.id };
      return null;
    },
    async findConversationById(conversationId: string) {
      const c = conversations.get(conversationId);
      return c ? { id: c.id, createdAt: c.createdAt, lastMessageAt: c.lastMessageAt } : null;
    },
    async insertConversationWithParticipants(pairKey: string, userIds: [string, string]) {
      if ([...conversations.values()].some((c) => c.pairKey === pairKey)) return null;
      const id = nextId();
      conversations.set(id, {
        id,
        pairKey,
        createdAt: tick(0),
        lastMessageAt: null,
        participants: [...userIds],
        lastReadAt: new Map([
          [userIds[0], null],
          [userIds[1], null],
        ]),
      });
      return { id };
    },
    async listParticipantIds(conversationId: string) {
      return conversations.get(conversationId)?.participants ?? [];
    },
    async isParticipant(conversationId: string, userId: string) {
      return conversations.get(conversationId)?.participants.includes(userId) ?? false;
    },
    async participantLastReadAt(conversationId: string, userId: string) {
      return conversations.get(conversationId)?.lastReadAt.get(userId) ?? null;
    },
    async inboxPage(input: { userId: string; page: number; pageSize: number }) {
      const rows = [...conversations.values()]
        .filter((c) => c.participants.includes(input.userId))
        .sort((a, b) => {
          const aKey = a.lastMessageAt ? a.lastMessageAt.getTime() : 0;
          const bKey = b.lastMessageAt ? b.lastMessageAt.getTime() : 0;
          return bKey - aKey || b.id.localeCompare(a.id);
        });
      return {
        rows: rows
          .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
          .map((c) => ({
            id: c.id,
            createdAt: c.createdAt,
            lastMessageAt: c.lastMessageAt,
            lastReadAt: c.lastReadAt.get(input.userId) ?? null,
            peer: {
              id: c.participants.find((id) => id !== input.userId) as string,
              username: `user-${c.participants.find((id) => id !== input.userId)?.slice(0, 4)}`,
              displayName: null,
              avatarMediaKey: null,
              avatarMediaThumbKey: null,
            },
          })),
        total: rows.length,
      };
    },
    async touchConversation(conversationId: string, at: Date) {
      const c = conversations.get(conversationId);
      if (c) c.lastMessageAt = at;
    },
    async insertMessage(input: {
      conversationId: string;
      senderId: string;
      body: string | null;
      attachmentMediaId: string | null;
    }) {
      const createdAt = tick();
      const id = nextId();
      messages.set(id, { id, ...input, createdAt, deletedAt: null });
      return { id, createdAt };
    },
    async findMessageById(messageId: string) {
      const m = messages.get(messageId);
      if (!m) return null;
      const mediaRow = m.attachmentMediaId ? media.get(m.attachmentMediaId) : undefined;
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        body: m.deletedAt ? null : m.body,
        createdAt: m.createdAt,
        deletedAt: m.deletedAt,
        attachment:
          !m.deletedAt && mediaRow
            ? {
                mediaId: mediaRow.id,
                mime: mediaRow.mime,
                sizeBytes: mediaRow.sizeBytes,
                key: mediaRow.key,
                thumbKey: mediaRow.thumbKey,
              }
            : null,
      };
    },
    async messagesPage(input: { conversationId: string; page: number; pageSize: number }) {
      const rows = [...messages.values()]
        .filter((m) => m.conversationId === input.conversationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      return {
        rows: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
        total: rows.length,
      };
    },
    async countUnread(conversationId: string, userId: string) {
      const c = conversations.get(conversationId);
      const since = c?.lastReadAt.get(userId) ?? new Date(0);
      return [...messages.values()].filter(
        (m) => m.conversationId === conversationId && m.senderId !== userId && m.createdAt > since,
      ).length;
    },
    async countUnreadForMany(conversationIds: string[], userId: string) {
      const out: Array<{ conversationId: string; unread: number }> = [];
      for (const conversationId of conversationIds) {
        out.push({ conversationId, unread: await repo.countUnread(conversationId, userId) });
      }
      return out;
    },
    async markRead(input: { conversationId: string; userId: string; at: Date }) {
      const c = conversations.get(input.conversationId);
      if (!c) return;
      const current = c.lastReadAt.get(input.userId) ?? new Date(0);
      if (input.at > current) c.lastReadAt.set(input.userId, input.at);
    },
    async softDeleteOwnMessage(messageId: string, senderId: string) {
      const m = messages.get(messageId);
      if (!m || m.senderId !== senderId || m.deletedAt) return false;
      m.deletedAt = new Date();
      return true;
    },
    async lastMessagesFor(conversationIds: string[]) {
      const out: Array<{
        conversationId: string;
        id: string;
        senderId: string;
        body: string | null;
        deletedAt: Date | null;
        createdAt: Date;
        attachmentMediaId: string | null;
      }> = [];
      for (const conversationId of conversationIds) {
        const rows = [...messages.values()]
          .filter((m) => m.conversationId === conversationId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const last = rows[0];
        if (last) out.push({ ...last, conversationId });
      }
      return out;
    },
    async findAttachmentCandidate(mediaId: string) {
      return media.get(mediaId) ?? null;
    },
    async existsBlockBetween(userA: string, userB: string) {
      return blocks.has(`${userA}:${userB}`) || blocks.has(`${userB}:${userA}`);
    },
    async insertBlock(input: { blockerId: string; blockedId: string }) {
      const key = `${input.blockerId}:${input.blockedId}`;
      if (blocks.has(key)) return null;
      blocks.set(key, new Date());
      return { createdAt: new Date() };
    },
    async deleteBlock(blockerId: string, blockedId: string) {
      return blocks.delete(`${blockerId}:${blockedId}`);
    },
    async listBlocks(blockerId: string) {
      return [...blocks.entries()]
        .filter(([key]) => key.startsWith(`${blockerId}:`))
        .map(([key, blockedAt]) => {
          const userId = key.split(':')[1] as string;
          return {
            userId,
            username: `user-${userId.slice(0, 4)}`,
            displayName: null,
            avatarMediaKey: null,
            avatarMediaThumbKey: null,
            blockedAt,
          };
        });
    },
    async insertReport(input: {
      messageId: string;
      reporterId: string;
      reason: string;
      details: string | null;
    }) {
      if (
        reports.some((r) => r.messageId === input.messageId && r.reporterId === input.reporterId)
      ) {
        return null;
      }
      const id = nextId();
      reports.push({ id, messageId: input.messageId, reporterId: input.reporterId });
      return { id };
    },
  };
  return { repo, usersCtx, conversations, messages, blocks, media, attached, reports };
}

type MessagingRepoFake = ReturnType<typeof makeMemoryMessagingRepo>;

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
let messagingRepo: MessagingRepoFake;
const auditActions: string[] = [];
let user: LoginSession;
let peer: LoginSession;
let stranger: LoginSession;
let userId: string;
let peerId: string;
let strangerId: string;

beforeAll(async () => {
  const redis = new FakeRedis();
  messagingRepo = makeMemoryMessagingRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined), route: vi.fn() })
    .overrideProvider(MESSAGING_REPOSITORY)
    .useValue(messagingRepo.repo)
    .overrideProvider(MEDIA_SERVICE)
    .useValue({
      async markAttached(mediaId: string) {
        messagingRepo.attached.push(mediaId);
        return { id: mediaId };
      },
    })
    .overrideProvider(BUSINESSES_REPOSITORY)
    .useValue({
      async findSummariesByIds() {
        return [];
      },
    })
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

  const userRow = await createUser(app, { username: 'msguser', password: 'Sup3rSecret!2026' });
  const peerRow = await createUser(app, { username: 'msgpeer', password: 'Sup3rSecret!2026' });
  const strangerRow = await createUser(app, {
    username: 'msgstranger',
    password: 'Sup3rSecret!2026',
  });
  user = await loginAs(app, 'msguser', 'Sup3rSecret!2026');
  peer = await loginAs(app, 'msgpeer', 'Sup3rSecret!2026');
  stranger = await loginAs(app, 'msgstranger', 'Sup3rSecret!2026');
  userId = userRow.id;
  peerId = peerRow.id;
  strangerId = strangerRow.id;
  messagingRepo.usersCtx.set(userId, { status: 'active' });
  messagingRepo.usersCtx.set(peerId, { status: 'active' });
  messagingRepo.usersCtx.set(strangerId, { status: 'active' });
  // attachment candidates (MY_MEDIA owned by the user; foreign + wrong kind)
  messagingRepo.media.set(MY_MEDIA, {
    id: MY_MEDIA,
    kind: 'message_attachment',
    mime: 'image/webp',
    sizeBytes: 1234,
    key: 'message_attachment/2026/01/a.webp',
    thumbKey: null,
    ownerUserId: userId,
    deletedAt: null,
  });
  messagingRepo.media.set(FOREIGN_MEDIA, {
    id: FOREIGN_MEDIA,
    kind: 'message_attachment',
    mime: 'image/webp',
    sizeBytes: 1234,
    key: 'message_attachment/2026/01/b.webp',
    thumbKey: null,
    ownerUserId: peerId,
    deletedAt: null,
  });
  messagingRepo.media.set(WRONG_KIND_MEDIA, {
    id: WRONG_KIND_MEDIA,
    kind: 'review_photo',
    mime: 'image/webp',
    sizeBytes: 1234,
    key: 'review_photo/2026/01/c.webp',
    thumbKey: null,
    ownerUserId: userId,
    deletedAt: null,
  });
});

afterAll(async () => {
  await app?.close();
});

const createConversation = (peer: string, bearer: string) =>
  request(app.getHttpServer())
    .post('/api/v1/messaging/conversations')
    .set({ Authorization: bearer })
    .send({ peerId: peer });

const getInbox = (bearer: string, query = '') =>
  request(app.getHttpServer())
    .get(`/api/v1/messaging/conversations${query}`)
    .set({ Authorization: bearer });

const getThread = (conversationId: string, bearer: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/messaging/conversations/${conversationId}/messages`)
    .set({ Authorization: bearer });

const sendMessage = (conversationId: string, body: object, bearer: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/messaging/conversations/${conversationId}/messages`)
    .set({ Authorization: bearer })
    .send(body);

const markRead = (conversationId: string, messageId: string, bearer: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/messaging/conversations/${conversationId}/read`)
    .set({ Authorization: bearer })
    .send({ messageId });

const deleteMessage = (messageId: string, bearer: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/messaging/messages/${messageId}`)
    .set({ Authorization: bearer });

const reportMessage = (messageId: string, body: object, bearer: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/messaging/messages/${messageId}/report`)
    .set({ Authorization: bearer })
    .send(body);

const blockUser = (target: string, bearer: string) =>
  request(app.getHttpServer())
    .post('/api/v1/messaging/blocks')
    .set({ Authorization: bearer })
    .send({ userId: target });

const unblockUser = (target: string, bearer: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/messaging/blocks/${target}`)
    .set({ Authorization: bearer });

const getBlocks = (bearer: string) =>
  request(app.getHttpServer()).get('/api/v1/messaging/blocks').set({ Authorization: bearer });

describe('Messaging HTTP — B5.6', () => {
  it('401s every messaging route without a bearer', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/messaging/conversations')).status).toBe(
      401,
    );
    expect(
      (await request(app.getHttpServer()).post('/api/v1/messaging/conversations')).status,
    ).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/messaging/blocks')).status).toBe(401);
    expect(
      (
        await request(app.getHttpServer()).delete(
          '/api/v1/messaging/messages/00000000-0000-4000-8000-000000000000',
        )
      ).status,
    ).toBe(401);
  });

  it('create conversation: 201 created → second POST returns the SAME id with created:false', async () => {
    const first = await createConversation(peerId, user.bearer);
    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(true);
    expect(first.body.data.peer).toMatchObject({
      id: peerId,
      username: 'user-' + peerId.slice(0, 4),
    });
    expect(first.body.data.unreadCount).toBe(0);

    const second = await createConversation(userId, peer.bearer); // reversed pair!
    expect(second.status).toBe(201);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('self-conversation is 422, unknown peer 404, garbage peerId 400', async () => {
    expect((await createConversation(userId, user.bearer)).status).toBe(422);
    expect(
      (await createConversation('99999999-9999-4999-8999-999999999999', user.bearer)).status,
    ).toBe(404);
    expect((await createConversation('not-a-uuid', user.bearer)).status).toBe(400);
  });

  it('send → thread → read receipt: the full DM loop over HTTP', async () => {
    const conversation = (await createConversation(peerId, user.bearer)).body.data.id;

    const sent = await sendMessage(conversation, { body: 'سلام، کافه فردا بازه؟' }, user.bearer);
    expect(sent.status).toBe(201);
    expect(sent.body.data.body).toBe('سلام، کافه فردا بازه؟');
    expect(sent.body.data.senderId).toBe(userId);
    const messageId = sent.body.data.id as string;

    // empty message (neither body nor attachment) → 400 (contract refine)
    expect((await sendMessage(conversation, {}, user.bearer)).status).toBe(400);

    // the peer reads the thread (member-only; stranger → 404)
    const thread = await getThread(conversation, peer.bearer);
    expect(thread.status).toBe(200);
    expect(thread.body.data.items).toHaveLength(1);
    expect((await getThread(conversation, stranger.bearer)).status).toBe(404);

    // receipt: unread drops to 0 for the peer
    const inboxBefore = await getInbox(peer.bearer);
    expect(inboxBefore.body.data.items[0].unreadCount).toBe(1);
    expect(inboxBefore.body.data.items[0].lastMessage.bodyPreview).toBe('سلام، کافه فردا بازه؟');
    const receipt = await markRead(conversation, messageId, peer.bearer);
    expect(receipt.status).toBe(201);
    expect(receipt.body.data).toMatchObject({
      ok: true,
      lastReadMessageId: messageId,
      unreadCount: 0,
    });
    const inboxAfter = await getInbox(peer.bearer);
    expect(inboxAfter.body.data.items[0].unreadCount).toBe(0);
  });

  it('attachment send: unknown 404, wrong kind 422, foreign 403, own OK + markAttached called', async () => {
    const conversation = (await createConversation(peerId, user.bearer)).body.data.id;
    expect(
      (
        await sendMessage(
          conversation,
          { attachmentMediaId: '99999999-9999-4999-8999-999999999999' },
          user.bearer,
        )
      ).status,
    ).toBe(404);
    expect(
      (await sendMessage(conversation, { attachmentMediaId: WRONG_KIND_MEDIA }, user.bearer))
        .status,
    ).toBe(422);
    expect(
      (await sendMessage(conversation, { attachmentMediaId: FOREIGN_MEDIA }, user.bearer)).status,
    ).toBe(403);
    const ok = await sendMessage(conversation, { attachmentMediaId: MY_MEDIA }, user.bearer);
    expect(ok.status).toBe(201);
    expect(ok.body.data.attachment).toMatchObject({ mediaId: MY_MEDIA, mime: 'image/webp' });
    expect(messagingRepo.attached).toContain(MY_MEDIA);
  });

  it('block gates WRITES symmetrically (403 both ways), reads stay open, unblock reopens', async () => {
    const conversation = (await createConversation(peerId, user.bearer)).body.data.id;
    await sendMessage(conversation, { body: 'قبل از بلاک' }, user.bearer);

    expect((await blockUser(userId, user.bearer)).status).toBe(422); // self-block
    const block = await blockUser(peerId, user.bearer);
    expect(block.status).toBe(201);
    expect(block.body.data).toEqual({ userId: peerId, blocked: true });
    expect((await blockUser(peerId, user.bearer)).status).toBe(409);
    expect(auditActions).toContain('user.block');

    expect((await sendMessage(conversation, { body: 'نوشته نشد' }, peer.bearer)).status).toBe(403);
    expect((await sendMessage(conversation, { body: 'نوشته نشد' }, user.bearer)).status).toBe(403);
    expect((await getThread(conversation, peer.bearer)).status).toBe(200); // reads open

    expect((await getBlocks(user.bearer)).status).toBe(200);
    const unblock = await unblockUser(peerId, user.bearer);
    expect(unblock.body.data).toEqual({ userId: peerId, blocked: false });
    expect((await unblockUser(peerId, user.bearer)).status).toBe(200); // idempotent
    expect((await sendMessage(conversation, { body: 'بعد از رفع بلاک' }, user.bearer)).status).toBe(
      201,
    );
  });

  it('delete: sender-only soft delete; the thread keeps a placeholder; audit off for sends', async () => {
    const conversation = (await createConversation(peerId, user.bearer)).body.data.id;
    const sent = await sendMessage(conversation, { body: 'حذف می‌کنم' }, user.bearer);
    const messageId = sent.body.data.id as string;

    expect((await deleteMessage(messageId, peer.bearer)).status).toBe(403);
    expect((await deleteMessage(messageId, user.bearer)).status).toBe(200);
    const thread = await getThread(conversation, peer.bearer);
    const row = thread.body.data.items.find((m: { id: string }) => m.id === messageId);
    expect(row.body).toBeNull();
    expect(row.deletedAt).not.toBeNull();
  });

  it('report: member-only, once per (message, reporter), audited; double → 409', async () => {
    const conversation = (await createConversation(peerId, user.bearer)).body.data.id;
    const sent = await sendMessage(conversation, { body: 'اسپم' }, user.bearer);
    const messageId = sent.body.data.id as string;

    expect((await reportMessage(messageId, { reason: 'spam' }, stranger.bearer)).status).toBe(404);
    const ok = await reportMessage(
      messageId,
      { reason: 'spam', details: 'تبلیغ است' },
      peer.bearer,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.data.reported).toBe(true);
    expect((await reportMessage(messageId, { reason: 'abuse' }, peer.bearer)).status).toBe(409);
    expect((await reportMessage(messageId, { reason: 'not-a-reason' }, peer.bearer)).status).toBe(
      400,
    );
    expect(auditActions).toContain('message.report');
  });
});
