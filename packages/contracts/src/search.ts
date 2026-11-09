import { z } from 'zod';
import { uuidSchema } from './primitives.js';
import { geoPointSchema, type GeoPoint } from './catalog.js';
import { priceLevelSchema } from './business.js';
import { pageMetaSchema } from './pagination.js';

/**
 * Search API contracts (B3.2). The public `GET /api/v1/search` endpoint takes
 * a free-text `q`, a set of facet filters (city, neighborhood, categories,
 * amenities, tags, price level, minimum rating), an optional geo origin + radius
 * (meters) for distance sort/filtering, and a sort mode. The server normalizes
 * `q` with the shared `normalizePersianText` before building the tsquery.
 *
 * `openNow` is intentionally NOT in this schema — "open now" depends on the
 * weekly-hours + special-days + timezone computation in `HoursService` (B2.5),
 * which lives in TypeScript, not SQL; filtering it at the DB level would
 * duplicate that logic or break pagination. It is recorded as a Follow-up
 * (materialized `currently_open` column refreshed by a job, or a SQL port of
 * `computeOpenStatus`).
 */

/** Sort modes for business search. `relevance` is the default when `q` is present;
 * `rating` is the default otherwise. `distance` requires `lat`+`lng`. */
export const SEARCH_SORTS = ['relevance', 'rating', 'distance', 'newest'] as const;
export const searchSortSchema = z.enum(SEARCH_SORTS);
export type SearchSort = z.infer<typeof searchSortSchema>;

/** Radius in meters from the geo origin; capped at 50 km (local-business scope). */
export const searchRadiusSchema = z.coerce.number().int().min(1).max(50_000);

/** Query string: free text, 1–200 chars after trim. The server normalizes
 * Persian/Arabic variants before building the tsquery. */
export const searchQueryStringSchema = z.string().trim().min(1).max(200);

/**
 * The full search query. All filters are optional and compose with AND. Arrays
 * use `z.coerce.number`/string where the HTTP layer passes strings; UUID arrays
 * accept a comma-separated list (the controller splits before validation, or the
 * pipe accepts a pre-split array — kept simple here: the controller splits on
 * `,` so the schema sees `string[]`). */
export const searchQuerySchema = z
  .object({
    q: searchQueryStringSchema.optional(),
    cityId: uuidSchema.optional(),
    neighborhoodId: uuidSchema.optional(),
    categoryIds: z.array(uuidSchema).max(20).optional(),
    amenityIds: z.array(uuidSchema).max(40).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    priceLevel: priceLevelSchema.optional(),
    minRating: z.coerce.number().min(0).max(5).step(0.5).optional(),
    /** Geo origin for `distance` sort and radius filtering. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: searchRadiusSchema.optional(),
    sort: searchSortSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((q) => q.sort !== 'distance' || (q.lat !== undefined && q.lng !== undefined), {
    message: 'sort=distance requires lat and lng',
    path: ['sort'],
  })
  .refine((q) => !((q.lat !== undefined) !== (q.lng !== undefined)), {
    message: 'lat and lng must be provided together',
    path: ['lat'],
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * A single search hit. A `BusinessSummary` subset plus `distance` (meters from
 * the origin, null when no origin) and `rank` (ts_rank score, 0 when no text
 * query). Kept lean so the list endpoint stays cheap; the client fetches the
 * full detail via `GET /businesses/:idOrSlug` when needed.
 */
export const searchHitSchema = z
  .object({
    id: uuidSchema,
    slug: z.string().min(1).max(80),
    name: z.string().min(1).max(200),
    nameAlt: z.string().max(200).nullable(),
    primaryCategoryId: uuidSchema,
    primaryCategorySlug: z.string().min(1).max(80),
    primaryCategoryName: z.record(z.string(), z.string()),
    cityId: uuidSchema,
    citySlug: z.string().min(1).max(80),
    cityName: z.record(z.string(), z.string()),
    neighborhoodId: uuidSchema.nullable(),
    address: z.string().min(1).max(500),
    location: geoPointSchema,
    priceLevel: priceLevelSchema.nullable(),
    avgRating: z.number().min(0).max(5),
    reviewCount: z.number().int().min(0),
    coverUrl: z.string().nullable(),
    thumbUrl: z.string().nullable(),
    isFeatured: z.boolean(),
    /** Meters from the geo origin; null when no `lat`/`lng` was supplied. */
    distance: z.number().min(0).nullable(),
    /** ts_rank of the hit against the (normalized) query; 0 when no `q`. */
    rank: z.number().min(0),
  })
  .strict();
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchResultSchema = z
  .object({
    items: z.array(searchHitSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type SearchResult = z.infer<typeof searchResultSchema>;

/** The normalized query the service hands the repository: `q` already run
 * through `normalizePersianText` (+ digit normalization), the default sort
 * resolved (relevance when q present, rating otherwise), and the effective
 * limit/offset computed. The repository treats this as opaque input. */
export interface NormalizedSearchQuery {
  q: string | null;
  cityId?: string;
  neighborhoodId?: string;
  categoryIds?: string[];
  amenityIds?: string[];
  tags?: string[];
  priceLevel?: number;
  minRating?: number;
  lat?: number;
  lng?: number;
  radius?: number;
  sort: SearchSort;
  limit: number;
  offset: number;
}

export type { GeoPoint };
