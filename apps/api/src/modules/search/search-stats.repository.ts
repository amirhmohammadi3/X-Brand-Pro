import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { cities, searchHistory, searchQueries } from '../../db/schema/index.js';
import { DrizzleClient } from '../../db/drizzle.client.js';

/**
 * Search-stats repository (B3.5) — the SQL layer behind search history and
 * popular queries. Two tables, one upsert each:
 *
 * - `search_queries` — the GLOBAL popularity counter, bumped on every search
 *   with a non-empty `q`, keyed by `(normalized_text, city_id)` (unique with
 *   NULLS NOT DISTINCT so the anonymous variant conflicts correctly and the
 *   ON CONFLICT upsert fires). No user identity is ever written here.
 * - `search_history` — the PER-USER history, upserted only when the searcher
 *   is authenticated; re-searching the same text (same canonical form) bumps
 *   `searched_at` and refreshes the display `text`, moving the entry to the
 *   top. The service prunes beyond the per-user cap after every insert.
 *
 * All user input reaches the database through Drizzle parameter placeholders.
 */
@Injectable()
export class SearchStatsRepository {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  /** Bump the global popularity counter (insert row 1, or hits+1 on conflict). */
  async upsertPopular(input: {
    normalizedText: string;
    text: string;
    cityId: string | null;
    resultCount: number;
  }): Promise<void> {
    await this.client.db
      .insert(searchQueries)
      .values({
        normalizedText: input.normalizedText,
        text: input.text,
        cityId: input.cityId,
        resultCount: input.resultCount,
      })
      .onConflictDoUpdate({
        target: [searchQueries.normalizedText, searchQueries.cityId],
        set: {
          hits: sql`${searchQueries.hits} + 1`,
          resultCount: input.resultCount,
          lastSearchedAt: new Date(),
        },
      });
  }

  /** Upsert one history row for the user (bump `searched_at` + refresh the
   * display text on re-search). */
  async upsertHistory(input: {
    userId: string;
    normalizedText: string;
    text: string;
    cityId: string | null;
  }): Promise<void> {
    await this.client.db
      .insert(searchHistory)
      .values({
        userId: input.userId,
        normalizedText: input.normalizedText,
        text: input.text,
        cityId: input.cityId,
      })
      .onConflictDoUpdate({
        target: [searchHistory.userId, searchHistory.normalizedText, searchHistory.cityId],
        set: { text: input.text, searchedAt: new Date() },
      });
  }

  /** Delete the user's history rows beyond the newest `keep` entries (the
   * per-user cap enforced on every record — `id DESC` is the stable
   * tiebreaker for equal `searched_at`). */
  async pruneHistory(userId: string, keep: number): Promise<void> {
    await this.client.db.execute(sql`
      DELETE FROM search_history
      WHERE user_id = ${userId}
        AND id NOT IN (
          SELECT id FROM search_history WHERE user_id = ${userId}
          ORDER BY searched_at DESC, id DESC LIMIT ${keep}
        )
    `);
  }

  /** The user's history, newest first, with the city name joined for the
   * disambiguation line. */
  async listHistory(userId: string, limit: number) {
    return this.client.db
      .select({
        id: searchHistory.id,
        text: searchHistory.text,
        cityId: searchHistory.cityId,
        cityName: cities.name,
        searchedAt: searchHistory.searchedAt,
      })
      .from(searchHistory)
      .leftJoin(cities, eq(cities.id, searchHistory.cityId))
      .where(eq(searchHistory.userId, userId))
      .orderBy(desc(searchHistory.searchedAt), desc(searchHistory.id))
      .limit(limit);
  }

  /** Clear the user's whole history; returns the number of removed rows. */
  async clearHistory(userId: string): Promise<number> {
    const rows = await this.client.db
      .delete(searchHistory)
      .where(eq(searchHistory.userId, userId))
      .returning({ id: searchHistory.id });
    return rows.length;
  }

  /** Remove one history entry owned by the user; false when it does not exist
   * (or belongs to someone else — both are a plain 404 upstream). */
  async removeHistoryItem(userId: string, id: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(searchHistory)
      .where(and(eq(searchHistory.userId, userId), eq(searchHistory.id, id)))
      .returning({ id: searchHistory.id });
    return rows.length > 0;
  }

  /** The global popular queries, `hits DESC` then `last_searched_at DESC` then
   * text (stable), optionally scoped to one city (undefined = everything). */
  async listPopular(cityId: string | undefined, limit: number) {
    return this.client.db
      .select({
        text: searchQueries.text,
        cityId: searchQueries.cityId,
        cityName: cities.name,
        hits: searchQueries.hits,
        lastSearchedAt: searchQueries.lastSearchedAt,
      })
      .from(searchQueries)
      .leftJoin(cities, eq(cities.id, searchQueries.cityId))
      .where(cityId ? eq(searchQueries.cityId, cityId) : undefined)
      .orderBy(
        desc(searchQueries.hits),
        desc(searchQueries.lastSearchedAt),
        desc(searchQueries.text),
      )
      .limit(limit);
  }
}
