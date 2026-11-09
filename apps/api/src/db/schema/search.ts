import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { cities } from './geo.js';
import { users } from './users.js';

/**
 * Search statistics tables (B3.5) — the write side of search history and
 * popular queries.
 *
 * `search_queries` is the GLOBAL popularity counter: one row per normalized
 * query text (+ optional city scope), a `hits` counter bumped on every search,
 * no user identity at all (privacy: aggregate text only). The unique key is
 * `(normalized_text, city_id)` with `NULLS NOT DISTINCT` (Postgres 15+; the
 * stack pins PostGIS/Postgres 16) so the anonymous variant (`city_id IS NULL`)
 * is exactly ONE row per text and the `ON CONFLICT` upsert fires for it too —
 * without `NULLS NOT DISTINCT` Postgres would treat two NULL city_ids as
 * distinct and the upsert would never conflict.
 *
 * `search_history` is the PER-USER history: upserted on every search by a
 * logged-in user (re-searching bumps `searched_at`, moving the query to the
 * top) and pruned to the newest `HISTORY_LIMIT` rows per user by the service.
 * The unique key `(user_id, normalized_text, city_id)` (also `NULLS NOT
 * DISTINCT`) makes the upsert idempotent. Users own this data and can clear
 * it (DELETE endpoints in B3.5).
 *
 * `normalized_text` is the canonical form (`normalizePersianText` +
 * `normalizeDigits` — DECISIONS B3.1/B3.2), so Arabic-spelled and
 * Persian-spelled duplicates collapse into one counter/one history entry;
 * `text` keeps the first-seen display spelling.
 */
export const searchQueries = pgTable(
  'search_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    normalizedText: text('normalized_text').notNull(),
    text: text('text').notNull(),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'cascade' }),
    hits: integer('hits').notNull().default(1),
    resultCount: integer('result_count').notNull().default(0),
    lastSearchedAt: timestamp('last_searched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('search_queries_normalized_city_uniq')
      .on(table.normalizedText, table.cityId)
      .nullsNotDistinct(),
    index('search_queries_popular_idx').on(table.hits.desc(), table.lastSearchedAt.desc()),
    index('search_queries_city_idx').on(table.cityId),
  ],
);

export const searchHistory = pgTable(
  'search_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    normalizedText: text('normalized_text').notNull(),
    text: text('text').notNull(),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
    searchedAt: timestamp('searched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('search_history_user_query_uniq')
      .on(table.userId, table.normalizedText, table.cityId)
      .nullsNotDistinct(),
    index('search_history_user_recent_idx').on(table.userId, table.searchedAt.desc()),
  ],
);
