import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  BlockedUser,
  BlocksResult,
  ConversationCard,
  ConversationMessagesResult,
  CreateConversationResult,
  InboxResult,
  LastMessagePreview,
  MarkReadResult,
  Message,
  MessageAttachment,
  MessageDeletedEvent,
  MessageCreatedEvent,
  MessageReportReason,
  DeleteMessageResult,
  ReportMessageResult,
  BlockResult,
} from '@app/contracts';
import { MESSAGING_EVENTS, MESSAGING_PREVIEW_MAX_LEN } from '@app/contracts';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaService, MEDIA_SERVICE } from '../media/media.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import {
  MESSAGING_REPOSITORY,
  type InboxConversationRow,
  type LastMessageRow,
  type MessageDetailRow,
  type MessagingRepositoryLike,
  type MessagingUserCard,
} from './messaging.repository.js';

/**
 * Domain events (AGENTS.md 6) — emitted AFTER the row is committed. The
 * realtime module subscribes and fans `conversation:message` out to the
 * `conversation:<id>` room + the recipients' user rooms; B5.7's notification
 * wiring can subscribe to the same signal later. A listener failure must
 * never break the send — EventEmitter2 is sync-dispatch; subscribers own
 * their try/catch (mirrors the follows activity subscriber).
 */
function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
}

function ruleException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message,
      details,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function forbiddenException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'FORBIDDEN' as const,
      messageKey: 'errors.forbidden',
      message,
      details,
    },
    HttpStatus.FORBIDDEN,
  );
}

function conflictException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'CONFLICT' as const,
      messageKey: 'errors.conflict',
      message,
      details,
    },
    HttpStatus.CONFLICT,
  );
}

/** The DM identity: deterministic, order-free, unique per unordered pair. */
export function pairKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

/** Inbox preview: trimmed body, attachment marker, deleted placeholder. */
function previewFor(row: LastMessageRow): LastMessagePreview {
  const body = row.deletedAt
    ? null
    : (row.body ?? '').trim().slice(0, MESSAGING_PREVIEW_MAX_LEN) || null;
  return {
    id: row.id,
    senderId: row.senderId,
    bodyPreview: body,
    hasAttachment: row.attachmentMediaId !== null,
    createdAt: row.createdAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

/**
 * Messaging (B5.6). Rules:
 * - DMs are get-or-create on the unordered pair (`pair_key`); self-chat is
 *   422, an unknown/inactive peer answers the SAME 404 (B4.10 no-leak), a
 *   block in EITHER direction is a 403 — a block is meant to be felt;
 * - every conversation read/write requires membership; a non-member gets a
 *   404 indistinguishable from an unknown conversation id (no existence
 *   leak through the messaging surface);
 * - a message needs a body OR an attachment (SQL CHECK backs the contract);
 *   the attachment must be the SENDER'S OWN `message_attachment` media row
 *   (kind + ownership re-checked here, markAttached stamps the lifecycle);
 * - blocks gate WRITES symmetrically, never reads — history stays visible;
 * - a report is participant-visible-content only, once per (message, user).
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepositoryLike,
    @Inject(MEDIA_SERVICE) private readonly media: MediaService,
    private readonly mediaUrls: MediaUrlService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ─── conversations ────────────────────────────────────────────────────

  /** POST /messaging/conversations — get-or-create the DM with `peerId`. */
  async createConversation(userId: string, peerId: string): Promise<CreateConversationResult> {
    if (userId === peerId) {
      throw ruleException('You cannot open a conversation with yourself', { peerId });
    }
    const peer = await this.repo.findUserContext(peerId);
    // blocked/deleted peers answer the SAME 404 as unknown ids — no leak.
    if (!peer || peer.status !== 'active') {
      throw notFoundException('User', peerId);
    }
    if (await this.repo.existsBlockBetween(userId, peerId)) {
      throw forbiddenException('Messaging is blocked between these users', { peerId });
    }

    const pairKey = pairKeyFor(userId, peerId);
    let conversationId = (await this.repo.findConversationByPairKey(pairKey))?.id ?? null;
    let created = false;
    if (!conversationId) {
      const inserted = await this.repo.insertConversationWithParticipants(pairKey, [
        userId,
        peerId,
      ]);
      if (inserted) {
        conversationId = inserted.id;
        created = true;
      } else {
        // Concurrent first POST — the unique index won; read the winner.
        conversationId = (await this.repo.findConversationByPairKey(pairKey))?.id ?? null;
      }
    }
    if (!conversationId) {
      throw conflictException('Conversation could not be created', { peerId });
    }

    const cards = await this.repo.findUserCards([peerId]);
    const peerCard = cards[0];
    const card = await this.buildCard(conversationId, userId, {
      id: peerId,
      username: peerCard?.username ?? '',
      displayName: peerCard?.displayName ?? null,
      avatarMediaKey: peerCard?.avatarMediaKey ?? null,
      avatarMediaThumbKey: peerCard?.avatarMediaThumbKey ?? null,
    });
    if (!card) throw notFoundException('Conversation', conversationId);
    return { ...card, created };
  }

  /** GET /messaging/conversations — the inbox page (newest activity first). */
  async inbox(userId: string, query: { page: number; pageSize: number }): Promise<InboxResult> {
    const { rows, total } = await this.repo.inboxPage({
      userId,
      page: query.page,
      pageSize: query.pageSize,
    });
    const items = await this.buildCards(userId, rows);
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  // ─── messages ─────────────────────────────────────────────────────────

  /** GET /messaging/conversations/:id/messages — member-only thread page. */
  async messages(
    userId: string,
    conversationId: string,
    query: { page: number; pageSize: number },
  ): Promise<ConversationMessagesResult> {
    await this.assertMember(conversationId, userId);
    const { rows, total } = await this.repo.messagesPage({
      conversationId,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: rows.map((row) => this.toMessage(row, this.mediaUrls)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  /** POST /messaging/conversations/:id/messages — send into a DM. */
  async sendMessage(
    userId: string,
    conversationId: string,
    input: { body?: string; attachmentMediaId?: string },
  ): Promise<Message> {
    const conversation = await this.repo.findConversationById(conversationId);
    const isMember = conversation ? await this.repo.isParticipant(conversationId, userId) : false;
    // Unknown conversation AND foreign conversation answer the same 404 —
    // membership is the existence gate.
    if (!conversation || !isMember) {
      throw notFoundException('Conversation', conversationId);
    }

    const participantIds = await this.repo.listParticipantIds(conversationId);
    const peerId = participantIds.find((id) => id !== userId);
    if (peerId && (await this.repo.existsBlockBetween(userId, peerId))) {
      throw forbiddenException('Messaging is blocked between these users', { peerId });
    }

    // Attachment gate: the sender's own, alive, message_attachment media row.
    if (input.attachmentMediaId) {
      const candidate = await this.repo.findAttachmentCandidate(input.attachmentMediaId);
      if (!candidate || candidate.deletedAt) {
        throw notFoundException('Media', input.attachmentMediaId);
      }
      if (candidate.kind !== 'message_attachment') {
        throw ruleException('This media kind cannot be attached to a message', {
          mediaId: input.attachmentMediaId,
          kind: candidate.kind,
        });
      }
      if (candidate.ownerUserId !== userId) {
        throw forbiddenException('Not your media', { mediaId: input.attachmentMediaId });
      }
    }

    const inserted = await this.repo.insertMessage({
      conversationId,
      senderId: userId,
      body: input.body ?? null,
      attachmentMediaId: input.attachmentMediaId ?? null,
    });
    if (input.attachmentMediaId) {
      // Lifecycle stamp AFTER the message row exists (an upload left
      // unattached for >24h would otherwise be reaped by the cleanup job).
      await this.media.markAttached(input.attachmentMediaId, userId);
    }
    await this.repo.touchConversation(conversationId, inserted.createdAt);

    const event: MessageCreatedEvent = {
      conversationId,
      messageId: inserted.id,
      senderId: userId,
      recipientIds: participantIds.filter((id) => id !== userId),
      createdAt: inserted.createdAt.toISOString(),
    };
    this.emitter.emit(MESSAGING_EVENTS.messageCreated, event);

    const row = await this.repo.findMessageById(inserted.id);
    if (!row) throw notFoundException('Message', inserted.id);
    return this.toMessage(row, this.mediaUrls);
  }

  /** POST /messaging/conversations/:id/read — advance the read receipt. */
  async markRead(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MarkReadResult> {
    await this.assertMember(conversationId, userId);
    const message = await this.repo.findMessageById(messageId);
    if (!message || message.conversationId !== conversationId) {
      throw ruleException('Message does not belong to this conversation', { messageId });
    }
    await this.repo.markRead({ conversationId, userId, at: message.createdAt });
    const unreadCount = await this.repo.countUnread(conversationId, userId);
    return { ok: true, lastReadMessageId: messageId, unreadCount };
  }

  /** DELETE /messaging/messages/:id — sender-only soft delete (idempotent). */
  async deleteMessage(userId: string, messageId: string): Promise<DeleteMessageResult> {
    const message = await this.repo.findMessageById(messageId);
    if (!message) throw notFoundException('Message', messageId);
    if (message.senderId !== userId) {
      throw forbiddenException('Only the sender can delete a message', { messageId });
    }
    const deleted = await this.repo.softDeleteOwnMessage(messageId, userId);
    if (deleted) {
      const participantIds = await this.repo.listParticipantIds(message.conversationId);
      const event: MessageDeletedEvent = {
        conversationId: message.conversationId,
        messageId,
        senderId: userId,
        recipientIds: participantIds.filter((id) => id !== userId),
      };
      this.emitter.emit(MESSAGING_EVENTS.messageDeleted, event);
    }
    return { deleted: true };
  }

  // ─── blocks ───────────────────────────────────────────────────────────

  /** POST /messaging/blocks — block a user (both directions stop writing). */
  async blockUser(userId: string, targetId: string): Promise<BlockResult> {
    if (userId === targetId) {
      throw ruleException('You cannot block yourself', { targetId });
    }
    const target = await this.repo.findUserContext(targetId);
    if (!target || target.status !== 'active') {
      throw notFoundException('User', targetId);
    }
    const inserted = await this.repo.insertBlock({ blockerId: userId, blockedId: targetId });
    if (!inserted) {
      throw conflictException('User is already blocked', { targetId });
    }
    return { userId: targetId, blocked: true };
  }

  /** DELETE /messaging/blocks/:userId — idempotent unblock. */
  async unblockUser(userId: string, targetId: string): Promise<BlockResult> {
    await this.repo.deleteBlock(userId, targetId);
    return { userId: targetId, blocked: false };
  }

  /** GET /messaging/blocks — who I blocked (newest first). */
  async listBlocks(userId: string): Promise<BlocksResult> {
    const rows = await this.repo.listBlocks(userId);
    const items: BlockedUser[] = rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: this.mediaUrls.urlFor(row.avatarMediaThumbKey ?? row.avatarMediaKey),
      blockedAt: row.blockedAt.toISOString(),
    }));
    return { items };
  }

  // ─── reports ──────────────────────────────────────────────────────────

  /** POST /messaging/messages/:id/report — member-visible content only. */
  async reportMessage(
    userId: string,
    messageId: string,
    input: { reason: MessageReportReason; details?: string },
  ): Promise<ReportMessageResult> {
    const message = await this.repo.findMessageById(messageId);
    // Only content you can already see is reportable — a foreign message
    // id answers the same 404 as an unknown one.
    if (!message || !(await this.repo.isParticipant(message.conversationId, userId))) {
      throw notFoundException('Message', messageId);
    }
    const report = await this.repo.insertReport({
      messageId,
      reporterId: userId,
      reason: input.reason,
      details: input.details ?? null,
    });
    if (!report) {
      throw conflictException('You already reported this message', { messageId });
    }
    return { reported: true, reportId: report.id };
  }

  // ─── card assembly (shared by create + inbox) ─────────────────────────

  private async assertMember(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.repo.findConversationById(conversationId);
    const isMember = conversation ? await this.repo.isParticipant(conversationId, userId) : false;
    if (!conversation || !isMember) {
      throw notFoundException('Conversation', conversationId);
    }
  }

  private async buildCards(
    userId: string,
    rows: InboxConversationRow[],
  ): Promise<ConversationCard[]> {
    const ids = rows.map((r) => r.id);
    const [lastMessages, unread] = await Promise.all([
      this.repo.lastMessagesFor(ids),
      this.repo.countUnreadForMany(ids, userId),
    ]);
    const lastByConversation = new Map(lastMessages.map((m) => [m.conversationId, m]));
    const unreadByConversation = new Map(unread.map((u) => [u.conversationId, u.unread]));
    return rows.map((row) => ({
      id: row.id,
      peer: this.toPeer(row.peer),
      createdAt: row.createdAt.toISOString(),
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      lastMessage: (() => {
        const last = lastByConversation.get(row.id);
        return last ? previewFor(last) : null;
      })(),
      unreadCount: unreadByConversation.get(row.id) ?? 0,
    }));
  }

  /** One card assembled from primitives (createConversation path). */
  private async buildCard(
    conversationId: string,
    userId: string,
    peer: MessagingUserCard,
  ): Promise<ConversationCard | null> {
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation) return null;
    const [lastRows, unread] = await Promise.all([
      this.repo.lastMessagesFor([conversationId]),
      this.repo.countUnread(conversationId, userId),
    ]);
    const last = lastRows[0];
    return {
      id: conversationId,
      peer: this.toPeer(peer),
      createdAt: conversation.createdAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      lastMessage: last ? previewFor(last) : null,
      unreadCount: unread,
    };
  }

  private toPeer(card: MessagingUserCard): ConversationCard['peer'] {
    return {
      id: card.id,
      username: card.username,
      displayName: card.displayName,
      avatarUrl: this.mediaUrls.urlFor(card.avatarMediaThumbKey ?? card.avatarMediaKey),
    };
  }

  private toMessage(row: MessageDetailRow, urls: MediaUrlService): Message {
    const attachment: MessageAttachment | null = row.attachment
      ? {
          mediaId: row.attachment.mediaId,
          url: urls.urlFor(row.attachment.key) ?? '',
          thumbUrl: urls.urlFor(row.attachment.thumbKey ?? row.attachment.key),
          mime: row.attachment.mime,
          sizeBytes: row.attachment.sizeBytes,
        }
      : null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body: row.deletedAt ? null : row.body,
      attachment: row.deletedAt ? null : attachment,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
