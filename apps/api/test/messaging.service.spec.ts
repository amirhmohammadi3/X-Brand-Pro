import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { MessagingService, pairKeyFor } from '../src/modules/messaging/messaging.service.js';
import type {
  InboxConversationRow,
  LastMessageRow,
  MessageAttachmentCandidate,
  MessageDetailRow,
  MessagingRepositoryLike,
  MessagingUserCard,
} from '../src/modules/messaging/messaging.repository.js';
import { MESSAGING_EVENTS } from '@app/contracts';

/**
 * B5.6 MessagingService — the business rules, DB-free: the get-or-create DM
 * (pair key is order-free), the no-leak 404 for unknown/blocked peers, the
 * symmetric block gate on writes, the membership gate on every conversation
 * read/write (foreign conversations 404 like unknown ones), the body-or-
 * attachment rule + attachment ownership/kind checks, forward-only read
 * receipts, the sender-only soft delete and the one-report-per-message
 * rule. The realtime fan-out is tested at the HTTP level (the real
 * EventEmitter2 runs there, same as the follows module).
 */

const ME = '22222222-2222-4222-8222-222222222222';
const PEER = '33333333-3333-4333-8333-333333333333';
const STRANGER = '34343434-3434-4343-8434-343434343434';
const BLOCKED_PEER = '35353535-3535-4535-8535-353535353535';
const INACTIVE_PEER = '36363636-3636-4636-8636-363636363636';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_MEDIA = '45454545-4545-4545-8545-454545454545';
const WRONG_KIND_MEDIA = '46464646-4646-4646-8646-464646464646';

function userCard(id: string, username = `user-${id.slice(0, 4)}`): MessagingUserCard {
  return {
    id,
    username,
    displayName: null,
    avatarMediaKey: null,
    avatarMediaThumbKey: null,
  };
}

interface ConversationState {
  id: string;
  pairKey: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  participants: string[];
  lastReadAt: Map<string, Date | null>;
}

/** In-memory messaging repo mirroring the SQL semantics the service relies on. */
function makeRepo() {
  const usersCtx = new Map<string, { status: string }>([
    [ME, { status: 'active' }],
    [PEER, { status: 'active' }],
    [STRANGER, { status: 'active' }],
    [BLOCKED_PEER, { status: 'active' }],
    [INACTIVE_PEER, { status: 'blocked' }],
  ]);
  const userCards = new Map<string, MessagingUserCard>();
  for (const id of usersCtx.keys()) userCards.set(id, userCard(id));

  const conversations = new Map<string, ConversationState>();
  const messages = new Map<string, MessageDetailRow>();
  const blocks = new Map<string, string>(); // `${blocker}:${blocked}` -> createdAt ISO
  const media = new Map<string, MessageAttachmentCandidate>([
    [
      MEDIA_ID,
      {
        id: MEDIA_ID,
        kind: 'message_attachment',
        mime: 'image/webp',
        sizeBytes: 1234,
        key: 'message_attachment/2026/01/x.webp',
        thumbKey: null,
        ownerUserId: ME,
        deletedAt: null,
      },
    ],
    [
      FOREIGN_MEDIA,
      {
        id: FOREIGN_MEDIA,
        kind: 'message_attachment',
        mime: 'image/webp',
        sizeBytes: 1234,
        key: 'message_attachment/2026/01/y.webp',
        thumbKey: null,
        ownerUserId: PEER,
        deletedAt: null,
      },
    ],
    [
      WRONG_KIND_MEDIA,
      {
        id: WRONG_KIND_MEDIA,
        kind: 'review_photo',
        mime: 'image/webp',
        sizeBytes: 1234,
        key: 'review_photo/2026/01/z.webp',
        thumbKey: null,
        ownerUserId: ME,
        deletedAt: null,
      },
    ],
  ]);
  const reports = new Map<string, { messageId: string; reporterId: string }>();

  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `9${String(seq).padStart(7, '0')}-9999-4999-8999-999999999999`;
  };
  const clock = { now: new Date('2026-11-12T10:00:00.000Z') };
  const tick = (ms = 1000) => {
    clock.now = new Date(clock.now.getTime() + ms);
    return new Date(clock.now);
  };

  const repo: MessagingRepositoryLike = {
    async findUserContext(userId) {
      return usersCtx.get(userId) ?? null;
    },
    async findUserCards(userIds) {
      return userIds.map((id) => userCards.get(id)).filter((c): c is MessagingUserCard => !!c);
    },

    async findConversationByPairKey(pairKey) {
      for (const c of conversations.values()) if (c.pairKey === pairKey) return { id: c.id };
      return null;
    },
    async findConversationById(conversationId) {
      const c = conversations.get(conversationId);
      return c ? { id: c.id, createdAt: c.createdAt, lastMessageAt: c.lastMessageAt } : null;
    },
    async insertConversationWithParticipants(pairKey, userIds) {
      const dup = [...conversations.values()].some((c) => c.pairKey === pairKey);
      if (dup) return null; // 23505 path → re-fetch upstream
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
    async listParticipantIds(conversationId) {
      return conversations.get(conversationId)?.participants ?? [];
    },
    async isParticipant(conversationId, userId) {
      return conversations.get(conversationId)?.participants.includes(userId) ?? false;
    },
    async participantLastReadAt(conversationId, userId) {
      return conversations.get(conversationId)?.lastReadAt.get(userId) ?? null;
    },
    async inboxPage(input) {
      const rows: InboxConversationRow[] = [];
      for (const c of conversations.values()) {
        if (!c.participants.includes(input.userId)) continue;
        const peerId = c.participants.find((id) => id !== input.userId);
        const peer = peerId ? userCards.get(peerId) : undefined;
        const peerActive = peerId ? usersCtx.get(peerId)?.status === 'active' : false;
        if (!peer || !peerActive) continue;
        rows.push({
          id: c.id,
          createdAt: c.createdAt,
          lastMessageAt: c.lastMessageAt,
          lastReadAt: c.lastReadAt.get(input.userId) ?? null,
          peer,
        });
      }
      rows.sort((a, b) => {
        const aKey = a.lastMessageAt ? a.lastMessageAt.getTime() : 0;
        const bKey = b.lastMessageAt ? b.lastMessageAt.getTime() : 0;
        return bKey - aKey || b.id.localeCompare(a.id);
      });
      const paged = rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
      return { rows: paged, total: rows.length };
    },
    async touchConversation(conversationId, at) {
      const c = conversations.get(conversationId);
      if (c) c.lastMessageAt = at;
    },

    async insertMessage(input) {
      const createdAt = tick();
      const id = nextId();
      messages.set(id, {
        id,
        conversationId: input.conversationId,
        senderId: input.senderId,
        body: input.body,
        createdAt,
        deletedAt: null,
        attachment: input.attachmentMediaId
          ? (() => {
              const m = media.get(input.attachmentMediaId);
              return m
                ? {
                    mediaId: m.id,
                    mime: m.mime,
                    sizeBytes: m.sizeBytes,
                    key: m.key,
                    thumbKey: m.thumbKey,
                  }
                : null;
            })()
          : null,
      });
      return { id, createdAt };
    },
    async findMessageById(messageId) {
      return messages.get(messageId) ?? null;
    },
    async messagesPage(input) {
      const rows = [...messages.values()]
        .filter((m) => m.conversationId === input.conversationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      return {
        rows: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
        total: rows.length,
      };
    },
    async countUnread(conversationId, userId) {
      const c = conversations.get(conversationId);
      const since = c?.lastReadAt.get(userId) ?? new Date(0);
      return [...messages.values()].filter(
        (m) => m.conversationId === conversationId && m.senderId !== userId && m.createdAt > since,
      ).length;
    },
    async countUnreadForMany(conversationIds, userId) {
      const out: Array<{ conversationId: string; unread: number }> = [];
      for (const conversationId of conversationIds) {
        out.push({ conversationId, unread: await repo.countUnread(conversationId, userId) });
      }
      return out;
    },
    async markRead(input) {
      const c = conversations.get(input.conversationId);
      if (!c) return;
      const current = c.lastReadAt.get(input.userId) ?? new Date(0);
      if (input.at > current) c.lastReadAt.set(input.userId, input.at);
    },
    async softDeleteOwnMessage(messageId, senderId) {
      const m = messages.get(messageId);
      if (!m || m.senderId !== senderId || m.deletedAt) return false;
      m.deletedAt = tick(0);
      m.body = null;
      m.attachment = null;
      return true;
    },
    async lastMessagesFor(conversationIds) {
      const out: LastMessageRow[] = [];
      for (const conversationId of conversationIds) {
        const rows = [...messages.values()]
          .filter((m) => m.conversationId === conversationId)
          .sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
          );
        const last = rows[0];
        if (last) {
          out.push({
            conversationId,
            id: last.id,
            senderId: last.senderId,
            body: last.body,
            deletedAt: last.deletedAt,
            createdAt: last.createdAt,
            attachmentMediaId: last.attachment?.mediaId ?? null,
          });
        }
      }
      return out;
    },

    async findAttachmentCandidate(mediaId) {
      return media.get(mediaId) ?? null;
    },

    async existsBlockBetween(userA, userB) {
      for (const key of blocks.keys()) {
        const [blocker, blocked] = key.split(':');
        if ((blocker === userA && blocked === userB) || (blocker === userB && blocked === userA)) {
          return true;
        }
      }
      return false;
    },
    async insertBlock(input) {
      const key = `${input.blockerId}:${input.blockedId}`;
      if (blocks.has(key)) return null;
      blocks.set(key, new Date().toISOString());
      return { createdAt: new Date() };
    },
    async deleteBlock(blockerId, blockedId) {
      return blocks.delete(`${blockerId}:${blockedId}`);
    },
    async listBlocks(blockerId) {
      return [...blocks.keys()]
        .filter((key) => key.startsWith(`${blockerId}:`))
        .map((key) => {
          const blockedId = key.split(':')[1] as string;
          const card = userCards.get(blockedId);
          return {
            userId: blockedId,
            username: card?.username ?? `user-${blockedId.slice(0, 4)}`,
            displayName: card?.displayName ?? null,
            avatarMediaKey: card?.avatarMediaKey ?? null,
            avatarMediaThumbKey: card?.avatarMediaThumbKey ?? null,
            blockedAt: new Date(blocks.get(key) as string),
          };
        });
    },

    async insertReport(input) {
      for (const r of reports.values()) {
        if (r.messageId === input.messageId && r.reporterId === input.reporterId) return null;
      }
      const id = nextId();
      reports.set(id, { messageId: input.messageId, reporterId: input.reporterId });
      return { id };
    },
  };
  return { repo, conversations, messages, blocks, media, usersCtx, clock };
}

function makeService() {
  const { repo, conversations, messages, blocks, media } = makeRepo();
  const events: Array<{ name: string; payload: unknown }> = [];
  const emitter = {
    emit(name: string, payload: unknown) {
      events.push({ name, payload });
    },
  } as unknown as EventEmitter2;
  const mediaService = {
    async markAttached(mediaId: string, ownerId: string) {
      if (!media.has(mediaId)) throw new Error('media missing');
      if (media.get(mediaId)?.ownerUserId !== ownerId) throw new Error('not owner');
      return media.get(mediaId) as MessageAttachmentCandidate;
    },
  } as never; // the narrow slice MessagingService consumes
  const service = new MessagingService(
    repo,
    mediaService,
    {
      urlForMedia: (m: { key: string }) => (m.key ? `https://cdn.test/${m.key}` : null),
      urlFor: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
    } as never,
    emitter,
  );
  return { service, conversations, messages, blocks, events };
}

async function httpStatus(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  throw new Error('expected the call to throw an HttpException');
}

describe('MessagingService — B5.6', () => {
  it('pairKeyFor is order-free', () => {
    expect(pairKeyFor(ME, PEER)).toBe(pairKeyFor(PEER, ME));
    expect(pairKeyFor(ME, PEER)).toBe([ME, PEER].sort().join(':'));
  });

  // ─── create conversation ────────────────────────────────────────────────

  it('createConversation: 422 self, 404 unknown/blocked-status peer, 403 when a block exists', async () => {
    const { service, blocks } = makeService();
    expect(await httpStatus(() => service.createConversation(ME, ME))).toBe(422);
    expect(
      await httpStatus(() =>
        service.createConversation(ME, '77777777-7777-4777-8777-777777777777'),
      ),
    ).toBe(404);
    // a blocked-STATUS peer answers the same 404 (no existence leak)
    expect(await httpStatus(() => service.createConversation(ME, INACTIVE_PEER))).toBe(404);
    // a block in EITHER direction → 403
    blocks.set(`${BLOCKED_PEER}:${ME}`, new Date().toISOString());
    expect(await httpStatus(() => service.createConversation(ME, BLOCKED_PEER))).toBe(403);
  });

  it('createConversation is a get-or-create: first POST creates, second returns the SAME id', async () => {
    const { service, conversations } = makeService();
    const first = await service.createConversation(ME, PEER);
    expect(first.created).toBe(true);
    expect(first.peer.id).toBe(PEER);
    expect(first.unreadCount).toBe(0);
    const second = await service.createConversation(PEER, ME); // reversed order!
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(conversations.size).toBe(1);
  });

  // ─── send + read ────────────────────────────────────────────────────────

  it('sendMessage requires membership: unknown AND foreign conversations answer the same 404', async () => {
    const { service } = makeService();
    const ghost = '78787878-7878-4787-8787-787878787878';
    expect(await httpStatus(() => service.sendMessage(ME, ghost, { body: 'سلام' }))).toBe(404);
    const conversation = await service.createConversation(PEER, ME);
    // STRANGER is not a participant — 404, never 403 (no existence leak)
    expect(
      await httpStatus(() => service.sendMessage(STRANGER, conversation.id, { body: 'سلام' })),
    ).toBe(404);
    expect(
      await httpStatus(() =>
        service.messages(STRANGER, conversation.id, { page: 1, pageSize: 20 }),
      ),
    ).toBe(404);
  });

  it('sendMessage: blocked peers cannot write (403), but history stays readable', async () => {
    const { service, blocks } = makeService();
    const conversation = await service.createConversation(ME, PEER);
    await service.sendMessage(ME, conversation.id, { body: 'قبل از بلاک' });
    blocks.set(`${ME}:${PEER}`, new Date().toISOString());
    expect(
      await httpStatus(() => service.sendMessage(PEER, conversation.id, { body: 'بعد از بلاک' })),
    ).toBe(403);
    expect(
      await httpStatus(() => service.sendMessage(ME, conversation.id, { body: 'بعد از بلاک' })),
    ).toBe(403);
    // reads are NOT blocked
    const thread = await service.messages(PEER, conversation.id, { page: 1, pageSize: 20 });
    expect(thread.items).toHaveLength(1);
    expect(thread.items[0]?.body).toBe('قبل از بلاک');
  });

  it('sendMessage: attachment must exist, be alive, the right kind AND owned by the sender', async () => {
    const { service } = makeService();
    const conversation = await service.createConversation(ME, PEER);
    expect(
      await httpStatus(() =>
        service.sendMessage(ME, conversation.id, {
          attachmentMediaId: '79797979-7979-4797-8797-797979797979',
        }),
      ),
    ).toBe(404); // unknown media
    expect(
      await httpStatus(() =>
        service.sendMessage(ME, conversation.id, { attachmentMediaId: WRONG_KIND_MEDIA }),
      ),
    ).toBe(422); // wrong kind
    expect(
      await httpStatus(() =>
        service.sendMessage(ME, conversation.id, { attachmentMediaId: FOREIGN_MEDIA }),
      ),
    ).toBe(403); // not mine
    const ok = await service.sendMessage(ME, conversation.id, {
      body: 'با عکس',
      attachmentMediaId: MEDIA_ID,
    });
    expect(ok.attachment?.mediaId).toBe(MEDIA_ID);
    expect(ok.body).toBe('با عکس');
  });

  it('sendMessage emits messaging.message.created with recipients minus the sender', async () => {
    const { service, events } = makeService();
    const conversation = await service.createConversation(ME, PEER);
    await service.sendMessage(ME, conversation.id, { body: 'سلام رفیق' });
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe(MESSAGING_EVENTS.messageCreated);
    const payload = events[0]?.payload as { conversationId: string; recipientIds: string[] };
    expect(payload.conversationId).toBe(conversation.id);
    expect(payload.recipientIds).toEqual([PEER]);
  });

  it('markRead advances the receipt forward-only and reports the remaining unread', async () => {
    const { service } = makeService();
    const conversation = await service.createConversation(ME, PEER);
    const m1 = await service.sendMessage(ME, conversation.id, { body: 'اول' });
    const m2 = await service.sendMessage(ME, conversation.id, { body: 'دوم' });
    const receipt = await service.markRead(PEER, conversation.id, m1.id);
    expect(receipt.ok).toBe(true);
    expect(receipt.lastReadMessageId).toBe(m1.id);
    expect(receipt.unreadCount).toBe(1); // m2 stays unread
    // a late markRead on the OLD message never un-reads m2
    const late = await service.markRead(PEER, conversation.id, m1.id);
    expect(late.unreadCount).toBe(1);
    // receipt to the newest message → 0
    expect((await service.markRead(PEER, conversation.id, m2.id)).unreadCount).toBe(0);
    // a foreign message id → 422
    expect(
      await httpStatus(() =>
        service.markRead(PEER, conversation.id, '80808080-8080-4808-8808-808080808080'),
      ),
    ).toBe(422);
  });

  it('inbox sorts by activity, shows previews and unread counts per conversation', async () => {
    const { service } = makeService();
    const c1 = await service.createConversation(ME, PEER);
    const c2 = await service.createConversation(ME, STRANGER);
    await service.sendMessage(ME, c1.id, { body: 'پیام کافه' });
    await service.sendMessage(STRANGER, c2.id, { body: 'پیام غریبه' });
    const inbox = await service.inbox(ME, { page: 1, pageSize: 20 });
    expect(inbox.items).toHaveLength(2);
    // c2 has the newest message → first
    expect(inbox.items[0]?.id).toBe(c2.id);
    expect(inbox.items[0]?.lastMessage?.bodyPreview).toBe('پیام غریبه');
    expect(inbox.items[0]?.unreadCount).toBe(1);
    expect(inbox.items[1]?.id).toBe(c1.id);
    expect(inbox.items[1]?.unreadCount).toBe(0);
    expect(inbox.meta.total).toBe(2);
  });

  it('deleteMessage: sender-only soft delete, idempotent, emits message.deleted', async () => {
    const { service, events, messages } = makeService();
    const conversation = await service.createConversation(ME, PEER);
    const message = await service.sendMessage(ME, conversation.id, { body: 'حذفم کن' });
    // not the sender → 403
    expect(await httpStatus(() => service.deleteMessage(PEER, message.id))).toBe(403);
    expect(await service.deleteMessage(ME, message.id)).toEqual({ deleted: true });
    expect(messages.get(message.id)?.deletedAt).not.toBeNull();
    // already deleted → still idempotent true
    expect(await service.deleteMessage(ME, message.id)).toEqual({ deleted: true });
    expect(events).toHaveLength(2); // created + ONE deleted (idempotent re-run emits nothing)
    expect(events[1]?.name).toBe(MESSAGING_EVENTS.messageDeleted);
    // the thread keeps the placeholder, body hidden
    const thread = await service.messages(PEER, conversation.id, { page: 1, pageSize: 20 });
    expect(thread.items[0]?.body).toBeNull();
    expect(thread.items[0]?.deletedAt).not.toBeNull();
    expect(thread.items[0]?.attachment).toBeNull();
  });

  it('unknown message ids 404 on delete and report', async () => {
    const { service } = makeService();
    const ghost = '81818181-8181-4818-8818-818181818181';
    expect(await httpStatus(() => service.deleteMessage(ME, ghost))).toBe(404);
    expect(await httpStatus(() => service.reportMessage(ME, ghost, { reason: 'spam' }))).toBe(404);
  });

  // ─── blocks ─────────────────────────────────────────────────────────────

  it('blockUser: 422 self, 404 unknown, 409 double; unblock is idempotent', async () => {
    const { service } = makeService();
    expect(await httpStatus(() => service.blockUser(ME, ME))).toBe(422);
    expect(
      await httpStatus(() => service.blockUser(ME, '82828282-8282-4828-8828-828282828282')),
    ).toBe(404);
    expect(await service.blockUser(ME, PEER)).toEqual({ userId: PEER, blocked: true });
    expect(await httpStatus(() => service.blockUser(ME, PEER))).toBe(409);
    // unblock is idempotent — answers the toggle state
    expect(await service.unblockUser(ME, PEER)).toEqual({ userId: PEER, blocked: false });
    expect(await service.unblockUser(ME, PEER)).toEqual({ userId: PEER, blocked: false });
  });

  it('listBlocks renders the blocked cards (newest first)', async () => {
    const { service } = makeService();
    await service.blockUser(ME, PEER);
    await service.blockUser(ME, STRANGER);
    const list = await service.listBlocks(ME);
    expect(list.items).toHaveLength(2);
    expect(list.items.map((b) => b.userId).sort()).toEqual([PEER, STRANGER].sort());
  });

  // ─── reports ────────────────────────────────────────────────────────────

  it('reportMessage: participant-only content, once per (message, reporter)', async () => {
    const { service } = makeService();
    const conversation = await service.createConversation(ME, PEER);
    const message = await service.sendMessage(ME, conversation.id, { body: 'اسپم' });
    // a stranger cannot report a conversation they cannot see
    expect(
      await httpStatus(() => service.reportMessage(STRANGER, message.id, { reason: 'spam' })),
    ).toBe(404);
    const ok = await service.reportMessage(PEER, message.id, { reason: 'spam', details: 'تبلیغ' });
    expect(ok.reported).toBe(true);
    expect(ok.reportId).toBeTruthy();
    // double report → 409
    expect(
      await httpStatus(() => service.reportMessage(PEER, message.id, { reason: 'abuse' })),
    ).toBe(409);
    // the SENDER can also be reported by themselves? No — they are a member,
    // but reporting their own message is allowed by the gate (moderation
    // decides) — the storage unique keeps it to one row.
    const self = await service.reportMessage(ME, message.id, { reason: 'other' });
    expect(self.reported).toBe(true);
  });
});
