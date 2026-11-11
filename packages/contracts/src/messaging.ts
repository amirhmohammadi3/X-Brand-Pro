import { z } from 'zod';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { uuidSchema } from './primitives.js';

/**
 * Messaging backend (B5.6) — direct user-to-user conversations with read
 * receipts, media attachments, blocking and reporting. Contracts are the
 * single source of truth for both apps: the API validates every payload
 * with these schemas and the web app (F5.6) renders from the same types.
 *
 * Domain rules (mirrored in messaging.service + the DB constraints):
 * - a DM is a TWO-participant conversation; `conversations.pair_key`
 *   ("smaller-uuid:larger-uuid") makes the pair unique at the storage layer,
 *   so POST /messaging/conversations is a GET-OR-CREATE (idempotent — the
 *   second POST returns the SAME conversation with created:false);
 * - a message carries a body (1..4000 chars) OR an attachment (the sender's
 *   `message_attachment` media row), never neither — the CHECK constraint
 *   `messages_has_content` enforces it in SQL, the body schema enforces the
 *   upper bound here;
 * - read receipts are per participant (`last_read_at`): the unread count is
 *   "messages newer than my last_read_at that I did not send";
 * - blocks are one-directional (`user_blocks.blocker_id -> blocked_id`) and
 *   SYMMETRIC in effect: with a block in either direction no NEW message or
 *   conversation can be created between the two users, while existing
 *   history stays visible (standard DM semantics — a block is felt, but it
 *   does not rewrite the past);
 * - reports are participant-visible-content only: you report a message of a
 *   conversation you belong to, once per (message, reporter).
 */

/** Hard cap on a message body (chars — Persian text counts per code point). */
export const MESSAGING_MESSAGE_MAX_LEN = 4000;

/** A preview rendered in the inbox never carries the full body. */
export const MESSAGING_PREVIEW_MAX_LEN = 80;

/**
 * Rate-limit rules (single source of truth for controller + tests):
 * - reads (inbox, thread, blocks list) → 60/min per user (private data,
 *   same reasoning as favorites/follows);
 * - writes (send, create, mark-read, delete) → 30/min per user (B5.1
 *   budget; mark-read is frequent but cheap — the same bucket is fine);
 * - block/unblock/report → 30/min per user (moderation-adjacent, audited).
 */
export const MESSAGING_READ_LIMIT_PER_MIN = 60;
export const MESSAGING_WRITE_LIMIT_PER_MIN = 30;
export const MESSAGING_MODERATION_LIMIT_PER_MIN = 30;

/**
 * Domain event emitted on every persisted message (B5.6). The realtime
 * subscriber (realtime module) turns it into `conversation:message` pushes
 * on the `conversation:<id>` room + the participants' user rooms — the ONLY
 * transport hop. Kept in contracts so both modules share one spelling
 * without importing each other (no module cycle).
 */
export const MESSAGING_EVENTS = {
  messageCreated: 'messaging.message.created',
  messageDeleted: 'messaging.message.deleted',
} as const;

/** Wire payload of `messaging.message.created` (zod-guarded in the subscriber). */
export const messageCreatedEventSchema = z
  .object({
    conversationId: uuidSchema,
    messageId: uuidSchema,
    senderId: uuidSchema,
    /** Every other participant — the push targets minus the sender. */
    recipientIds: z.array(uuidSchema).min(1),
    /** ISO timestamp of the persisted row (drives inbox re-sort). */
    createdAt: z.string(),
  })
  .strict();
export type MessageCreatedEvent = z.infer<typeof messageCreatedEventSchema>;

/** Wire payload of `messaging.message.deleted` (soft delete of own message). */
export const messageDeletedEventSchema = z
  .object({
    conversationId: uuidSchema,
    messageId: uuidSchema,
    senderId: uuidSchema,
    recipientIds: z.array(uuidSchema).min(1),
  })
  .strict();
export type MessageDeletedEvent = z.infer<typeof messageDeletedEventSchema>;

// ─── conversations ────────────────────────────────────────────────────────

/** POST /messaging/conversations { peerId } — get-or-create a DM. */
export const createConversationBodySchema = z.object({ peerId: uuidSchema });
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;

/** The peer's identity card as the inbox/thread headers render it. */
export const conversationPeerSchema = z
  .object({
    id: uuidSchema,
    username: z.string().min(3),
    displayName: z.string().min(1).nullable(),
    avatarUrl: z.string().min(1).nullable(),
  })
  .strict();
export type ConversationPeer = z.infer<typeof conversationPeerSchema>;

/** The last message's inbox preview (body trimmed, attachment shown as marker). */
export const lastMessagePreviewSchema = z
  .object({
    id: uuidSchema,
    senderId: uuidSchema,
    /** Trimmed body — null when the message is attachment-only or deleted. */
    bodyPreview: z.string().min(1).nullable(),
    /** True when the message carries a media attachment. */
    hasAttachment: z.boolean(),
    createdAt: z.string(),
    /** True when the row was soft-deleted (preview shows a placeholder). */
    deleted: z.boolean(),
  })
  .strict();
export type LastMessagePreview = z.infer<typeof lastMessagePreviewSchema>;

/** One inbox row: the peer, the last message preview, the unread badge. */
export const conversationCardSchema = z
  .object({
    id: uuidSchema,
    peer: conversationPeerSchema,
    createdAt: z.string(),
    /** Conversation-level stamp = last message time (null for an empty thread). */
    lastMessageAt: z.string().nullable(),
    lastMessage: lastMessagePreviewSchema.nullable(),
    /** Messages newer than MY last_read_at that I did not send. */
    unreadCount: z.number().int().min(0),
  })
  .strict();
export type ConversationCard = z.infer<typeof conversationCardSchema>;

/** GET /messaging/conversations — the inbox, most recently active first. */
export const inboxResultSchema = z
  .object({
    items: z.array(conversationCardSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type InboxResult = z.infer<typeof inboxResultSchema>;

/** POST /messaging/conversations result — the card + whether a row was created. */
export const createConversationResultSchema = conversationCardSchema
  .extend({ created: z.boolean() })
  .strict();
export type CreateConversationResult = z.infer<typeof createConversationResultSchema>;

// ─── messages ─────────────────────────────────────────────────────────────

/** POST /messaging/conversations/:id/messages — body OR attachment (≥1). */
export const sendMessageBodySchema = z
  .object({
    body: z.string().min(1).max(MESSAGING_MESSAGE_MAX_LEN).optional(),
    attachmentMediaId: uuidSchema.optional(),
  })
  .strict()
  .refine((v) => v.body !== undefined || v.attachmentMediaId !== undefined, {
    message: 'a message needs a body or an attachment',
  });
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

/** The attachment as a message renders it (URLs resolved by MediaUrlService). */
export const messageAttachmentSchema = z
  .object({
    mediaId: uuidSchema,
    url: z.string().min(1),
    thumbUrl: z.string().min(1).nullable(),
    mime: z.string().min(1),
    sizeBytes: z.number().int().min(0),
  })
  .strict();
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

/** One thread row. Soft-deleted messages keep their id/stamp, body → null. */
export const messageSchema = z
  .object({
    id: uuidSchema,
    conversationId: uuidSchema,
    senderId: uuidSchema,
    body: z.string().min(1).nullable(),
    attachment: messageAttachmentSchema.nullable(),
    createdAt: z.string(),
    /** Non-null when soft-deleted (F5.6 renders a placeholder). */
    deletedAt: z.string().nullable(),
  })
  .strict();
export type Message = z.infer<typeof messageSchema>;

/** GET /messaging/conversations/:id — the thread, oldest page → newest. */
export const conversationMessagesResultSchema = z
  .object({
    items: z.array(messageSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type ConversationMessagesResult = z.infer<typeof conversationMessagesResultSchema>;

/**
 * GET /messaging/conversations/:id/messages query. Page-based like every
 * list; pages count from the OLDEST message (page 1 = the thread's start)
 * so a growing thread never shifts a reader's page out from under them —
 * the client walks backwards from the last page.
 */
export const conversationMessagesQuerySchema = pageQuerySchema;
export type ConversationMessagesQuery = z.infer<typeof conversationMessagesQuerySchema>;

/** POST /messaging/conversations/:id/read { messageId } — read receipt. */
export const markReadBodySchema = z.object({ messageId: uuidSchema });
export type MarkReadBody = z.infer<typeof markReadBodySchema>;

export const markReadResultSchema = z
  .object({
    ok: z.literal(true),
    /** The receipt actually persisted (the message must exist in the thread). */
    lastReadMessageId: uuidSchema,
    /** Unread count AFTER the receipt (0 for a fresh read). */
    unreadCount: z.number().int().min(0),
  })
  .strict();
export type MarkReadResult = z.infer<typeof markReadResultSchema>;

/** DELETE /messaging/messages/:id result (soft delete, sender-only). */
export const deleteMessageResultSchema = z.object({ deleted: z.boolean() }).strict();
export type DeleteMessageResult = z.infer<typeof deleteMessageResultSchema>;

// ─── blocks ───────────────────────────────────────────────────────────────

/** POST /messaging/blocks { userId } — block a user (they cannot message me). */
export const blockUserBodySchema = z.object({ userId: uuidSchema });
export type BlockUserBody = z.infer<typeof blockUserBodySchema>;

/** The blocked user as GET /messaging/blocks renders them. */
export const blockedUserSchema = z
  .object({
    userId: uuidSchema,
    username: z.string().min(3),
    displayName: z.string().min(1).nullable(),
    avatarUrl: z.string().min(1).nullable(),
    blockedAt: z.string(),
  })
  .strict();
export type BlockedUser = z.infer<typeof blockedUserSchema>;

export const blocksResultSchema = z.object({ items: z.array(blockedUserSchema) }).strict();
export type BlocksResult = z.infer<typeof blocksResultSchema>;

/** POST/DELETE block result — the toggle's new state (mirrors followResult). */
export const blockResultSchema = z.object({ userId: uuidSchema, blocked: z.boolean() }).strict();
export type BlockResult = z.infer<typeof blockResultSchema>;

// ─── reports ──────────────────────────────────────────────────────────────

/** The reasons F5.6 offers for reporting a message. */
export const MESSAGE_REPORT_REASONS = ['spam', 'abuse', 'scam', 'other'] as const;
export const messageReportReasonSchema = z.enum(MESSAGE_REPORT_REASONS);
export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];

/** POST /messaging/messages/:id/report { reason, details? } */
export const reportMessageBodySchema = z
  .object({
    reason: messageReportReasonSchema,
    details: z.string().min(1).max(500).optional(),
  })
  .strict();
export type ReportMessageBody = z.infer<typeof reportMessageBodySchema>;

export const reportMessageResultSchema = z
  .object({ reported: z.literal(true), reportId: uuidSchema })
  .strict();
export type ReportMessageResult = z.infer<typeof reportMessageResultSchema>;
