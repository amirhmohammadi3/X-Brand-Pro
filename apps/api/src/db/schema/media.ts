import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * Media (B1.9): every stored user file. The stored `key` is the storage
 * driver address (`<kind>/<yyyy>/<mm>/<uuid>.webp` for images, `.pdf` for
 * documents); public URLs are `MEDIA_PUBLIC_BASE/<key>`.
 *
 * Lifecycle: a row starts unattached (attached_at null) right after upload;
 * the owning prompt's flow calls markAttached when the file is actually
 * referenced by an entity (user avatar, business photo, review, ...). The
 * hourly `media:cleanup-orphans` job deletes rows that stay unattached for
 * more than 24 hours. deleteOwned() soft-deletes (deleted_at) and enqueues
 * physical file removal on the `media` queue.
 */
export const mediaKindEnum = pgEnum('media_kind', [
  'avatar',
  'business_photo',
  'review_photo',
  'menu_photo',
  'claim_document',
  'message_attachment',
  'verification_receipt',
]);

export const mediaFiles = pgTable(
  'media_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Circular table refs are fine: drizzle resolves the callback lazily.
    ownerUserId: uuid('owner_user_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    kind: mediaKindEnum('kind').notNull(),
    key: text('key').notNull().unique(),
    thumbKey: text('thumb_key'),
    // Stored (post-processing) mime: images are always image/webp, documents
    // keep their original mime (application/pdf today).
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('media_files_owner_created_idx').on(table.ownerUserId, table.createdAt),
    // Partial index: the orphan-cleanup scan only ever asks for unattached rows.
    index('media_files_unattached_idx')
      .on(table.attachedAt)
      .where(sql`attached_at is null`),
  ],
);

export type MediaFileRow = typeof mediaFiles.$inferSelect;
export type NewMediaFileRow = typeof mediaFiles.$inferInsert;
