import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Auto-suggest contracts (B3.3). The public `GET /api/v1/search/suggest`
 * endpoint powers a typeahead: as the user types, the server returns a small,
 * bounded list of matches across one or all of {business, category,
 * neighborhood, city}. The response is a flat list of lean, kind-tagged hits —
 * the client renders them uniformly and deep-links via `slug` + `kind`.
 *
 * Matching uses the B3.1 trigram indexes (`name_normalized` for businesses,
 * `name_fa` for the catalog/geo tables): a prefix ILIKE (`name ILIKE 'q%'`) is
 * the primary signal and uses the GIN trigram index for fast lookups;
 * `similarity()` provides the ranking tiebreaker. The query is normalised
 * server-side (`normalizePersianText` + `normalizeDigits` + Latin lowercasing)
 * so Arabic-spelled input matches Persian-spelled rows.
 *
 * Results are cached in Redis (`CacheService.wrap`) keyed by the normalised
 * prefix + scope + cityId + limit, TTL 60s — typeahead traffic is bursty and
 *重复, and a 60s staleness window is acceptable (a new business appears within a
 * minute of going active). Cache failures degrade to a miss (CacheService
 * already swallows Redis errors).
 */

/** Suggest scopes. `all` merges every scope (deduped by kind+id, capped to
 * `limit`); a single scope returns only that kind. */
export const SUGGEST_SCOPES = ['business', 'category', 'neighborhood', 'city', 'all'] as const;
export const suggestScopeSchema = z.enum(SUGGEST_SCOPES);
export type SuggestScope = z.infer<typeof suggestScopeSchema>;

/** The kind tag on every hit. Matches the scope (except `all` which yields a
 * mix). The client uses this to pick the right deep-link path. */
export const suggestKindSchema = z.enum(['business', 'category', 'neighborhood', 'city']);
export type SuggestKind = z.infer<typeof suggestKindSchema>;

/**
 * The suggest query. `q` is the raw prefix (1–60 chars, trimmed); the server
 * normalises it before matching. `scope` defaults to `all`; `cityId` scopes
 * neighborhood + business matches to a city (ignored for category/city scopes).
 * `limit` caps the result list (default 8, max 20) — typeahead wants a short
 * list, and the cap keeps the cache key space bounded.
 */
export const suggestQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(60),
    scope: suggestScopeSchema.default('all'),
    cityId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  })
  .strict();
export type SuggestQuery = z.infer<typeof suggestQuerySchema>;

/**
 * One suggest hit. `label` is the Persian display name (the canonical
 * user-facing string); `labelAlt` is the alternate-script name when present
 * (businesses' `name_alt`, or `name->>'en'` for catalog/geo rows). `sublabel`
 * is a hint line — a business's city name, a neighborhood's city name — so the
 * typeahead can disambiguate two same-named places. `score` is the trigram
 * similarity (0–1) used for ranking; clients may use it for highlighting but
 * should not display it.
 */
export const suggestHitSchema = z
  .object({
    kind: suggestKindSchema,
    id: uuidSchema,
    slug: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
    labelAlt: z.string().max(200).nullable(),
    sublabel: z.string().max(200).nullable(),
    score: z.number().min(0).max(1),
  })
  .strict();
export type SuggestHit = z.infer<typeof suggestHitSchema>;

export const suggestResultSchema = z
  .object({
    items: z.array(suggestHitSchema),
  })
  .strict();
export type SuggestResult = z.infer<typeof suggestResultSchema>;

/** The normalised prefix the service hands the repository: `q` run through
 * `normalizePersianText` + `normalizeDigits` + Latin lowercasing, with
 * internal SQL-wildcard characters (`%`, `_`, `\`) escaped so the ILIKE pattern
 * is a literal prefix ( defence-in-depth on top of the schema's 1–60 char bound). */
export interface NormalizedSuggestQuery {
  prefix: string;
  scope: SuggestScope;
  cityId?: string;
  limit: number;
}
