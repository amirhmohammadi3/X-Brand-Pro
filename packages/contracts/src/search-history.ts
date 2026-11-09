import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Search history & popular queries contracts (B3.5). The recording happens on
 * every `GET /search` with a non-empty `q` (best-effort, fire-through — a
 * recording failure never breaks the search itself):
 *
 * - `search_queries` (global, anonymous) — one row per normalized query text
 *   (+ optional city scope), a `hits` counter, no user identity. Served by
 *   the public `GET /search/popular` ("trending searches" chips).
 * - `search_history` (per-user) — upserted only when the searcher presents a
 *   valid access token (the global JwtAuthGuard skips @Public routes, so the
 *   SearchController resolves the optional user itself via `TokenService` —
 *   JWT verification only, no session/status round trips; a revoked session
 *   merely records one history row, while the history endpoints below enforce
 *   the full guard). Served by the authenticated `GET /search/history`, and
 *   owned by the user: `DELETE /search/history` clears, `DELETE /search/
 *   history/:id` removes one entry (404 when not owned).
 *
 * Both sides dedupe on the B3.1/3.2 canonical form (`normalizePersianText` +
 * `normalizeDigits`), so Arabic-spelled and Persian-spelled duplicates are the
 * same row; the display `text` keeps the first-seen spelling (history keeps
 * the LATEST spelling via the upsert's `text = EXCLUDED.text`).
 */

/** History list size: 1–20, default 10 (the UI shows a short recent list). */
export const searchHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();
export type SearchHistoryQuery = z.infer<typeof searchHistoryQuerySchema>;

/** One history entry. `cityName` (localized map, nullable) is joined for the
 * "کافه — تهران" disambiguation line; `searchedAt` is the last search time
 * (the upsert bumps it, so history reads newest-first by it). */
export const searchHistoryItemSchema = z
  .object({
    id: uuidSchema,
    text: z.string().min(1).max(200),
    cityId: uuidSchema.nullable(),
    cityName: z.record(z.string(), z.string()).nullable(),
    searchedAt: z.string().datetime(),
  })
  .strict();
export type SearchHistoryItem = z.infer<typeof searchHistoryItemSchema>;

export const searchHistoryResultSchema = z
  .object({
    items: z.array(searchHistoryItemSchema),
  })
  .strict();
export type SearchHistoryResult = z.infer<typeof searchHistoryResultSchema>;

/** Clear-all response: how many entries were removed. */
export const clearSearchHistoryResultSchema = z
  .object({
    deleted: z.number().int().min(0),
  })
  .strict();
export type ClearSearchHistoryResult = z.infer<typeof clearSearchHistoryResultSchema>;

/** Popular queries list: 1–20, default 10; optional city scope. */
export const popularQueriesQuerySchema = z
  .object({
    cityId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();
export type PopularQueriesQuery = z.infer<typeof popularQueriesQuerySchema>;

/** One popular query. `hits` is the global counter (all searchers, anonymous
 * included); never a per-user figure. */
export const popularQueryItemSchema = z
  .object({
    text: z.string().min(1).max(200),
    cityId: uuidSchema.nullable(),
    cityName: z.record(z.string(), z.string()).nullable(),
    hits: z.number().int().min(1),
    lastSearchedAt: z.string().datetime(),
  })
  .strict();
export type PopularQueryItem = z.infer<typeof popularQueryItemSchema>;

export const popularQueriesResultSchema = z
  .object({
    items: z.array(popularQueryItemSchema),
  })
  .strict();
export type PopularQueriesResult = z.infer<typeof popularQueriesResultSchema>;

/** The recording input the SearchController builds from a search hit: the
 * raw display text (schema-trimmed), the optional city filter and the result
 * count. `userId` is null for anonymous searches (popularity only). */
export interface SearchRecordInput {
  userId: string | null;
  text: string;
  cityId: string | null;
  resultCount: number;
}
