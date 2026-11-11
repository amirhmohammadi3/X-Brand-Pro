import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { mediaFiles } from './media.js';

/**
 * Messaging backend (B5.6). Five tables:
 *
 * - `conversations` — a DIRECT two-person thread. The DM pair is collapsed
 *   into one row via `pair_key` ("smaller-uuid:larger-uuid", enforced by
 *   `conversations_pair_key_shape` and unique per pair) so POST
 *   /messaging/conversations is a true get-or-create: the second POST finds
 *   the same row instead of forking a parallel thread. `last_message_at`
 *   is the denormalised inbox stamp — the inbox sorts by it (NULLS LAST)
 *   without touching `messages`.
 *
 * - `conversation_participants` — exactly the two members (a DM is closed:
 *   no group chats in B5.6, no invite surface exists). The read receipt is
 *   `last_read_at` per participant; the unread count is "messages newer
 *   than my stamp that I did not send" — one indexed range probe, no
 *   per-message receipt rows. A timestamp (not a message FK) was chosen
 *   DELIBERATELY: a last_read_message_id would create a
 *   participants↔messages FK cycle inside one migration and buy nothing —
 *   receipts only ever move forward in time.
 *
 * - `messages` — body OR attachment, never neither
 *   (`messages_has_content` CHECK; an empty message has no UI meaning).
 *   The attachment FK points at `media_files` (kind `message_attachment`,
 *   ownership re-checked by the service before markAttached) with ON DELETE
 *   SET NULL: the nightly orphan cleanup must be able to hard-delete a file
 *   row without dragging the message text with it. Deletion is SOFT
 *   (`deleted_at`) — the recipient keeps a placeholder, the sender's
 *   "delete for me" never rewrites the other side's screen silently.
 *
 * - `user_blocks` — one-directional rows (blocker → blocked), symmetric in
 *   EFFECT: the service checks BOTH directions before any write, so a block
 *   stops new messages in both directions while history stays readable.
 *   Self-blocks are impossible (`user_blocks_not_self`).
 *
 * - `message_reports` — the abuse pipe into moderation (F5.6/admin queue
 *   reads it): one report per (message, reporter) — `message_reports_unq`
 *   turns a double report into a 409, not a pile of duplicates. Status
 *   starts `open`; the admin queue (B7.x/Phase 10) transitions it.
 *
 * Every user FK cascades: a deleted account takes its conversations,
 * messages, blocks and reports with it (GDPR-style erasure, same as
 * favorites/follows).
 */

/** Report reasons (mirrors contracts MESSAGE_REPORT_REASONS — keep in sync). */
export const messageReportReasonEnum = pgEnum('message_report_reason', [
  'spam',
  'abuse',
  'scam',
  'other',
]);

/** Admin queue states (Phase 10 wires the UI; the column exists from day one). */
export const messageReportStatusEnum = pgEnum('message_report_status', [
  'open',
  'reviewed',
  'dismissed',
]);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** "smaller-uuid:larger-uuid" — the DM identity, computed by the service. */
    pairKey: text('pair_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (table) => [
    // One row per user pair — the get-or-create anchor.
    uniqueIndex('conversations_pair_key_unq').on(table.pairKey),
    // Shape guard: exactly two lowercase UUIDs joined by ':' (service-built).
    check(
      'conversations_pair_key_shape',
      sql`${table.pairKey} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Read receipt: everything older is read (moves forward only). */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A user sits in a conversation once.
    uniqueIndex('conversation_participants_unq').on(table.conversationId, table.userId),
    // The inbox join drives off (user_id → conversations.last_message_at).
    index('conversation_participants_user_idx').on(table.userId),
  ],
);

export type ConversationParticipantRow = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipantRow = typeof conversationParticipants.$inferInsert;

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body'),
    attachmentMediaId: uuid('attachment_media_id').references(() => mediaFiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // A message is text, media, or both — never neither.
    check(
      'messages_has_content',
      sql`${table.body} IS NOT NULL OR ${table.attachmentMediaId} IS NOT NULL`,
    ),
    // Upper bound enforced in SQL, not only in the zod contract.
    check(
      'messages_body_len',
      sql`${table.body} IS NULL OR char_length(${table.body}) BETWEEN 1 AND 4000`,
    ),
    // Thread pagination: newest first inside a conversation (id = tiebreak).
    index('messages_conversation_idx').on(table.conversationId, table.createdAt.desc(), table.id),
    // Reverse lookup: "my messages" (delete/report flows, moderation).
    index('messages_sender_idx').on(table.senderId, table.createdAt.desc(), table.id),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One block row per ordered pair; the send/create gate probes both directions.
    uniqueIndex('user_blocks_unq').on(table.blockerId, table.blockedId),
    // A user cannot block themselves.
    check('user_blocks_not_self', sql`${table.blockerId} <> ${table.blockedId}`),
    // Moderation reverse lookups ("who blocked X").
    index('user_blocks_blocked_idx').on(table.blockedId, table.createdAt.desc()),
  ],
);

export type UserBlockRow = typeof userBlocks.$inferSelect;
export type NewUserBlockRow = typeof userBlocks.$inferInsert;

export const messageReports = pgTable(
  'message_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: messageReportReasonEnum('reason').notNull(),
    details: text('details'),
    status: messageReportStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One report per (message, reporter) — the double report is a 409.
    uniqueIndex('message_reports_unq').on(table.messageId, table.reporterId),
    // The admin queue: open items first, newest first.
    index('message_reports_status_idx').on(table.status, table.createdAt.desc(), table.id),
    // "Reports I filed".
    index('message_reports_reporter_idx').on(table.reporterId, table.createdAt.desc()),
    check(
      'message_reports_details_len',
      sql`${table.details} IS NULL OR char_length(${table.details}) BETWEEN 1 AND 500`,
    ),
  ],
);

export type MessageReportRow = typeof messageReports.$inferSelect;
export type NewMessageReportRow = typeof messageReports.$inferInsert;
