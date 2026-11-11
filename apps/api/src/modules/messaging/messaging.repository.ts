import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { mediaFiles } from '../../db/schema/media.js';
import { users } from '../../db/schema/users.js';
import {
  conversationParticipants,
  conversations,
  messageReports,
  messages,
  userBlocks,
} from '../../db/schema/messaging.js';

/** DI token for the messaging repository (tests bind a fake). */
export const MESSAGING_REPOSITORY = Symbol('MESSAGING_REPOSITORY');

/** A user card as the inbox/thread/blocks reads serve it (avatar keys raw). */
export interface MessagingUserCard {
  id: string;
  username: string;
  displayName: string | null;
  avatarMediaKey: string | null;
  avatarMediaThumbKey: string | null;
}

/** One inbox row before DTO mapping: the conversation + peer + my receipt. */
export interface InboxConversationRow {
  id: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  peer: MessagingUserCard;
}

/** The last message of a conversation (inbox preview source). */
export interface LastMessageRow {
  conversationId: string;
  id: string;
  senderId: string;
  body: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  attachmentMediaId: string | null;
}

/** Unread counts per conversation id (one grouped probe for the page). */
export interface UnreadCountRow {
  conversationId: string;
  unread: number;
}

/** A message row with its attachment media (thread page source). */
export interface MessageDetailRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  attachment: {
    mediaId: string;
    mime: string;
    sizeBytes: number;
    key: string;
    thumbKey: string | null;
  } | null;
}

/** A blocked-user row (blocks list source). */
export interface BlockedUserRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarMediaKey: string | null;
  avatarMediaThumbKey: string | null;
  blockedAt: Date;
}

/** The attachment candidate for a send (validated by the service). */
export interface MessageAttachmentCandidate {
  id: string;
  kind: string;
  mime: string;
  sizeBytes: number;
  key: string;
  thumbKey: string | null;
  ownerUserId: string | null;
  deletedAt: Date | null;
}

export interface MessagingPage<T> {
  rows: T[];
  total: number;
}

/**
 * The narrow fake-able surface consumed by MessagingService (+ the realtime
 * gateway's conversation membership probe). Uniqueness races (23505 on
 * `conversations_pair_key_unq`, `user_blocks_unq`, `message_reports_unq`)
 * map to `null` HERE so the service answers a clean 409 without pg error
 * internals.
 */
export interface MessagingRepositoryLike {
  /** Existence + status of a user (peer/block target — the B4.10 gate). */
  findUserContext(userId: string): Promise<{ status: string } | null>;
  /** User cards for DTO mapping (inbox peers, blocks list). */
  findUserCards(userIds: string[]): Promise<MessagingUserCard[]>;

  // ─── conversations ────────────────────────────────────────────────────
  findConversationByPairKey(pairKey: string): Promise<{ id: string } | null>;
  findConversationById(
    conversationId: string,
  ): Promise<{ id: string; createdAt: Date; lastMessageAt: Date | null } | null>;
  /** Get-or-create; 23505 (concurrent first POST) → null → re-fetch upstream. */
  insertConversationWithParticipants(
    pairKey: string,
    userIds: [string, string],
  ): Promise<{ id: string } | null>;
  /** The two participant user ids (B5.6 DMs only). */
  listParticipantIds(conversationId: string): Promise<string[]>;
  /** One indexed probe — the realtime gateway's conversation-room gate. */
  isParticipant(conversationId: string, userId: string): Promise<boolean>;
  /** The caller's receipt (unread math + read flows). */
  participantLastReadAt(conversationId: string, userId: string): Promise<Date | null>;
  /** Inbox page: my conversations, most recently active first, active peers. */
  inboxPage(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<MessagingPage<InboxConversationRow>>;
  touchConversation(conversationId: string, at: Date): Promise<void>;

  // ─── messages ─────────────────────────────────────────────────────────
  insertMessage(input: {
    conversationId: string;
    senderId: string;
    body: string | null;
    attachmentMediaId: string | null;
  }): Promise<{ id: string; createdAt: Date }>;
  findMessageById(messageId: string): Promise<MessageDetailRow | null>;
  /** Thread page; page 1 = the OLDEST messages (see contracts). */
  messagesPage(input: {
    conversationId: string;
    page: number;
    pageSize: number;
  }): Promise<MessagingPage<MessageDetailRow>>;
  /** Unread = newer than my receipt, not sent by me. */
  countUnread(conversationId: string, userId: string): Promise<number>;
  countUnreadForMany(conversationIds: string[], userId: string): Promise<UnreadCountRow[]>;
  /** Receipt moves FORWARD only (greatest with the message's stamp). */
  markRead(input: { conversationId: string; userId: string; at: Date }): Promise<void>;
  /** Sender-only soft delete; returns false when nothing was deleted. */
  softDeleteOwnMessage(messageId: string, senderId: string): Promise<boolean>;
  /** The last message stamp per conversation (inbox preview, DISTINCT ON). */
  lastMessagesFor(conversationIds: string[]): Promise<LastMessageRow[]>;

  // ─── attachments ──────────────────────────────────────────────────────
  findAttachmentCandidate(mediaId: string): Promise<MessageAttachmentCandidate | null>;

  // ─── blocks ───────────────────────────────────────────────────────────
  /** True when a block exists in EITHER direction (the send/create gate). */
  existsBlockBetween(userA: string, userB: string): Promise<boolean>;
  insertBlock(input: { blockerId: string; blockedId: string }): Promise<{ createdAt: Date } | null>;
  /** Idempotent unblock — true when a row was actually removed. */
  deleteBlock(blockerId: string, blockedId: string): Promise<boolean>;
  listBlocks(blockerId: string): Promise<BlockedUserRow[]>;

  // ─── reports ──────────────────────────────────────────────────────────
  insertReport(input: {
    messageId: string;
    reporterId: string;
    reason: 'spam' | 'abuse' | 'scam' | 'other';
    details: string | null;
  }): Promise<{ id: string } | null>;
}

@Injectable()
export class MessagingRepository implements MessagingRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findUserContext(userId: string): Promise<{ status: string } | null> {
    const rows = await this.client.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserCards(userIds: string[]): Promise<MessagingUserCard[]> {
    if (userIds.length === 0) return [];
    const rows = await this.client.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarMediaKey: mediaFiles.key,
        avatarMediaThumbKey: mediaFiles.thumbKey,
      })
      .from(users)
      .leftJoin(mediaFiles, eq(mediaFiles.id, users.avatarMediaId))
      .where(inArray(users.id, userIds));
    return rows;
  }

  // ─── conversations ────────────────────────────────────────────────────

  async findConversationByPairKey(pairKey: string): Promise<{ id: string } | null> {
    const rows = await this.client.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.pairKey, pairKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async findConversationById(
    conversationId: string,
  ): Promise<{ id: string; createdAt: Date; lastMessageAt: Date | null } | null> {
    const rows = await this.client.db
      .select({
        id: conversations.id,
        createdAt: conversations.createdAt,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertConversationWithParticipants(
    pairKey: string,
    userIds: [string, string],
  ): Promise<{ id: string } | null> {
    try {
      const inserted = await this.client.db
        .insert(conversations)
        .values({ pairKey })
        .returning({ id: conversations.id });
      const conversation = inserted[0];
      if (!conversation) return null;
      await this.client.db
        .insert(conversationParticipants)
        .values(userIds.map((userId) => ({ conversationId: conversation.id, userId })));
      return conversation;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // pair race → re-fetch upstream
      throw error;
    }
  }

  async listParticipantIds(conversationId: string): Promise<string[]> {
    const rows = await this.client.db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    return rows.map((r) => r.userId);
  }

  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ) as SQL,
      )
      .limit(1);
    return rows.length > 0;
  }

  async participantLastReadAt(conversationId: string, userId: string): Promise<Date | null> {
    const rows = await this.client.db
      .select({ lastReadAt: conversationParticipants.lastReadAt })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ) as SQL,
      )
      .limit(1);
    return rows[0]?.lastReadAt ?? null;
  }

  async inboxPage(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<MessagingPage<InboxConversationRow>> {
    const me = conversationParticipants;
    // The second participant row of the same conversation (a DM has exactly
    // one "other"); the peer must be an `active` user (B4.10 visibility —
    // blocked/deleted peers stop appearing without any cleanup job).
    const baseWhere = sql`${me.userId} = ${input.userId}
      AND EXISTS (
        SELECT 1 FROM ${conversationParticipants} other
        WHERE other.conversation_id = ${me.conversationId}
          AND other.user_id <> ${input.userId}
          AND EXISTS (
            SELECT 1 FROM ${users} pu
            WHERE pu.id = other.user_id AND pu.status = 'active'
          )
      )`;

    const totalRows = await this.client.db
      .select({ value: count() })
      .from(conversationParticipants)
      .where(baseWhere);
    const total = Number(totalRows[0]?.value ?? 0);

    const pageRows = await this.client.db
      .select({
        id: conversations.id,
        createdAt: conversations.createdAt,
        lastMessageAt: conversations.lastMessageAt,
        lastReadAt: me.lastReadAt,
      })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, me.conversationId))
      .where(baseWhere)
      .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, desc(conversations.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    if (pageRows.length === 0) return { rows: [], total };

    // The "other" participant per paged conversation, in one probe.
    const others = await this.client.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          inArray(
            conversationParticipants.conversationId,
            pageRows.map((r) => r.id),
          ),
          sql`${conversationParticipants.userId} <> ${input.userId}`,
        ) as SQL,
      );
    const peerByConversation = new Map(others.map((o) => [o.conversationId, o.conversationId]));
    const peerIds = [...new Set([...peerByConversation.values()])];
    const cards = await this.findUserCards(peerIds);
    const cardById = new Map(cards.map((c) => [c.id, c]));

    const rows: InboxConversationRow[] = [];
    for (const row of pageRows) {
      const peerId = peerByConversation.get(row.id);
      const card = peerId ? cardById.get(peerId) : undefined;
      if (!card) continue; // peer vanished between the two probes — skip
      rows.push({
        id: row.id,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        lastReadAt: row.lastReadAt,
        peer: card,
      });
    }
    return { rows, total };
  }

  async touchConversation(conversationId: string, at: Date): Promise<void> {
    await this.client.db
      .update(conversations)
      .set({ lastMessageAt: at })
      .where(eq(conversations.id, conversationId));
  }

  // ─── messages ─────────────────────────────────────────────────────────

  async insertMessage(input: {
    conversationId: string;
    senderId: string;
    body: string | null;
    attachmentMediaId: string | null;
  }): Promise<{ id: string; createdAt: Date }> {
    const rows = await this.client.db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        senderId: input.senderId,
        body: input.body,
        attachmentMediaId: input.attachmentMediaId,
      })
      .returning({ id: messages.id, createdAt: messages.createdAt });
    const row = rows[0];
    if (!row) throw new Error('messaging: message insert returned no row');
    return row;
  }

  async findMessageById(messageId: string): Promise<MessageDetailRow | null> {
    const rows = await this.client.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        body: messages.body,
        createdAt: messages.createdAt,
        deletedAt: messages.deletedAt,
        attachmentMediaId: mediaFiles.id,
        mime: mediaFiles.mime,
        sizeBytes: mediaFiles.sizeBytes,
        key: mediaFiles.key,
        thumbKey: mediaFiles.thumbKey,
      })
      .from(messages)
      .leftJoin(mediaFiles, eq(mediaFiles.id, messages.attachmentMediaId))
      .where(eq(messages.id, messageId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body: row.body,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      attachment:
        row.attachmentMediaId && row.mime && row.sizeBytes !== null && row.key
          ? {
              mediaId: row.attachmentMediaId,
              mime: row.mime,
              sizeBytes: Number(row.sizeBytes),
              key: row.key,
              thumbKey: row.thumbKey,
            }
          : null,
    };
  }

  async messagesPage(input: {
    conversationId: string;
    page: number;
    pageSize: number;
  }): Promise<MessagingPage<MessageDetailRow>> {
    const where = eq(messages.conversationId, input.conversationId);
    const totalRows = await this.client.db.select({ value: count() }).from(messages).where(where);
    const total = Number(totalRows[0]?.value ?? 0);

    // Page 1 = the thread's OLDEST messages (stable under growth); the
    // client walks backwards from the last page. Within the page, order is
    // oldest → newest so F5.6 can append-render directly.
    const pageRows = await this.client.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        body: messages.body,
        createdAt: messages.createdAt,
        deletedAt: messages.deletedAt,
        attachmentMediaId: mediaFiles.id,
        mime: mediaFiles.mime,
        sizeBytes: mediaFiles.sizeBytes,
        key: mediaFiles.key,
        thumbKey: mediaFiles.thumbKey,
      })
      .from(messages)
      .leftJoin(mediaFiles, eq(mediaFiles.id, messages.attachmentMediaId))
      .where(where)
      .orderBy(messages.createdAt, messages.id)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      rows: pageRows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        senderId: row.senderId,
        body: row.body,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
        attachment:
          row.attachmentMediaId && row.mime && row.sizeBytes !== null && row.key
            ? {
                mediaId: row.attachmentMediaId,
                mime: row.mime,
                sizeBytes: Number(row.sizeBytes),
                key: row.key,
                thumbKey: row.thumbKey,
              }
            : null,
      })),
      total,
    };
  }

  async countUnread(conversationId: string, userId: string): Promise<number> {
    const receiptRows = await this.client.db
      .select({ lastReadAt: conversationParticipants.lastReadAt })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ) as SQL,
      )
      .limit(1);
    const since = receiptRows[0]?.lastReadAt ?? new Date(0);
    const rows = await this.client.db
      .select({ value: count() })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          gt(messages.createdAt, since),
          sql`${messages.senderId} <> ${userId}`,
        ) as SQL,
      );
    return Number(rows[0]?.value ?? 0);
  }

  async countUnreadForMany(conversationIds: string[], userId: string): Promise<UnreadCountRow[]> {
    if (conversationIds.length === 0) return [];
    const rows = await this.client.db
      .select({
        conversationId: messages.conversationId,
        unread: count(),
      })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.userId, userId),
        ) as SQL,
      )
      .where(
        and(
          inArray(messages.conversationId, conversationIds),
          gt(
            messages.createdAt,
            sql`COALESCE(${conversationParticipants.lastReadAt}, to_timestamp(0))`,
          ),
          sql`${messages.senderId} <> ${userId}`,
        ) as SQL,
      )
      .groupBy(messages.conversationId);
    return rows.map((r) => ({ conversationId: r.conversationId, unread: Number(r.unread) }));
  }

  async markRead(input: { conversationId: string; userId: string; at: Date }): Promise<void> {
    // Receipt only moves FORWARD — a late markRead on an old message never
    // un-reads newer ones.
    await this.client.db
      .update(conversationParticipants)
      .set({
        lastReadAt: sql`GREATEST(COALESCE(${conversationParticipants.lastReadAt}, to_timestamp(0)), ${input.at})`,
      })
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.userId, input.userId),
        ) as SQL,
      );
  }

  async softDeleteOwnMessage(messageId: string, senderId: string): Promise<boolean> {
    const rows = await this.client.db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.senderId, senderId),
          isNull(messages.deletedAt),
        ) as SQL,
      )
      .returning({ id: messages.id });
    return rows.length > 0;
  }

  async lastMessagesFor(conversationIds: string[]): Promise<LastMessageRow[]> {
    if (conversationIds.length === 0) return [];
    // DISTINCT ON: the newest row per conversation in one probe.
    const result = await this.client.db.execute(sql`
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id, m.id, m.sender_id, m.body, m.deleted_at, m.created_at, m.attachment_media_id
      FROM ${messages} m
      WHERE m.conversation_id IN (${sql.join(
        conversationIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
    `);
    const list = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
    return list.map((r) => ({
      conversationId: String(r.conversation_id),
      id: String(r.id),
      senderId: String(r.sender_id),
      body: (r.body as string | null) ?? null,
      deletedAt: (r.deleted_at as Date | null) ?? null,
      createdAt: r.created_at as Date,
      attachmentMediaId: (r.attachment_media_id as string | null) ?? null,
    }));
  }

  // ─── attachments ──────────────────────────────────────────────────────

  async findAttachmentCandidate(mediaId: string): Promise<MessageAttachmentCandidate | null> {
    const rows = await this.client.db
      .select({
        id: mediaFiles.id,
        kind: mediaFiles.kind,
        mime: mediaFiles.mime,
        sizeBytes: mediaFiles.sizeBytes,
        key: mediaFiles.key,
        thumbKey: mediaFiles.thumbKey,
        ownerUserId: mediaFiles.ownerUserId,
        deletedAt: mediaFiles.deletedAt,
      })
      .from(mediaFiles)
      .where(eq(mediaFiles.id, mediaId))
      .limit(1);
    return rows[0] ?? null;
  }

  // ─── blocks ───────────────────────────────────────────────────────────

  async existsBlockBetween(userA: string, userB: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ blockerId: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        sql`(${userBlocks.blockerId} = ${userA} AND ${userBlocks.blockedId} = ${userB})
         OR (${userBlocks.blockerId} = ${userB} AND ${userBlocks.blockedId} = ${userA})`,
      )
      .limit(1);
    return rows.length > 0;
  }

  async insertBlock(input: {
    blockerId: string;
    blockedId: string;
  }): Promise<{ createdAt: Date } | null> {
    try {
      const rows = await this.client.db
        .insert(userBlocks)
        .values(input)
        .returning({ createdAt: userBlocks.createdAt });
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // already blocked → 409
      throw error;
    }
  }

  async deleteBlock(blockerId: string, blockedId: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)) as SQL)
      .returning({ id: userBlocks.id });
    return rows.length > 0;
  }

  async listBlocks(blockerId: string): Promise<BlockedUserRow[]> {
    const rows = await this.client.db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarMediaKey: mediaFiles.key,
        avatarMediaThumbKey: mediaFiles.thumbKey,
        blockedAt: userBlocks.createdAt,
      })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, users.avatarMediaId))
      .where(eq(userBlocks.blockerId, blockerId))
      .orderBy(desc(userBlocks.createdAt));
    return rows;
  }

  // ─── reports ──────────────────────────────────────────────────────────

  async insertReport(input: {
    messageId: string;
    reporterId: string;
    reason: 'spam' | 'abuse' | 'scam' | 'other';
    details: string | null;
  }): Promise<{ id: string } | null> {
    try {
      const rows = await this.client.db
        .insert(messageReports)
        .values(input)
        .returning({ id: messageReports.id });
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // double report → 409
      throw error;
    }
  }
}
