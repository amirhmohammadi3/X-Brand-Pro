import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { users } from './users.js';

/**
 * Favorites and named lists (B5.1). Two tables:
 *
 * - `favorite_lists` — the user's collections. Every account owns ONE
 *   implicit default list (`is_default = true`, created lazily by the
 *   service on the first write — never on a read); the partial unique index
 *   `favorite_lists_one_default_per_user` makes a second default row
 *   impossible. Named lists are unique per user BY NAME
 *   (`favorite_lists_user_name_unq`) so "کافه‌های تهران" cannot be created
 *   twice — the second attempt is a 409, not a silent merge. The default
 *   list can never be deleted (the service refuses; the heart must not die
 *   with a named list), so every user always has exactly one target list.
 *
 * - `favorite_items` — the saved businesses. Each row carries a
 *   DENORMALISED `user_id` next to `list_id`: the
 *   `favorite_items_one_per_user` UNIQUE (user_id, business_id) index
 *   enforces "a business sits in at most one list per user" at the storage
 *   layer, which makes the heart state (`GET /favorites/me/check`) ONE
 *   indexed probe and turns named-list membership into a MOVE
 *   (PATCH list_id), never a copy. Deleting a list cascades its items —
 *   deleting the last named list takes the saved businesses with it (the
 *   default list is undeletable, so favorites themselves always survive).
 *
 * Both FKs cascade on user and business: a deleted account or business
 * takes its favorite rows with it. The business FK is the count source for
 * `favorite_items_business_idx` (B5.2 feed / B5.7 notifications read "who
 * favorited this business" from it).
 */
export const favoriteLists = pgTable(
  'favorite_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Exactly one default list per user (partial — named lists leave the slot free).
    uniqueIndex('favorite_lists_one_default_per_user')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
    // A named list's name is unique per user (exact match; the service trims).
    uniqueIndex('favorite_lists_user_name_unq').on(table.userId, table.name),
    // GET /favorites/me: default first, then newest (id is the stable tiebreak).
    index('favorite_lists_user_idx').on(
      table.isDefault,
      table.userId,
      table.createdAt.desc(),
      table.id,
    ),
    check('favorite_lists_name_len', sql`char_length(${table.name}) BETWEEN 1 AND 80`),
  ],
);

export type FavoriteListRow = typeof favoriteLists.$inferSelect;
export type NewFavoriteListRow = typeof favoriteLists.$inferInsert;

export const favoriteItems = pgTable(
  'favorite_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listId: uuid('list_id')
      .notNull()
      .references(() => favoriteLists.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ONE list per (user, business) — the module's core invariant (see above).
    uniqueIndex('favorite_items_one_per_user').on(table.userId, table.businessId),
    // List page reads: newest first within a list (id is the stable tiebreak).
    index('favorite_items_list_idx').on(table.listId, table.createdAt.desc(), table.id),
    // Reverse lookup (feed/notification/event consumers + admin counts).
    index('favorite_items_business_idx').on(table.businessId, table.createdAt.desc()),
    check(
      'favorite_items_note_len',
      sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND 280`,
    ),
  ],
);

export type FavoriteItemRow = typeof favoriteItems.$inferSelect;
export type NewFavoriteItemRow = typeof favoriteItems.$inferInsert;
