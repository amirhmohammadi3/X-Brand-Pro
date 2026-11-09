import { z } from 'zod';
import {
  bboxSchema,
  geoPointSchema,
  longitudeSchema,
  latitudeSchema,
  type Bbox,
} from './catalog.js';
import { uuidSchema } from './primitives.js';

/**
 * Map endpoint contracts (B3.4). The public `GET /api/v1/map/businesses`
 * endpoint feeds the MapLibre map (F3.1/F3.4): given a viewport bbox and a
 * zoom level it returns either grid clusters (zoomed out) or individual
 * business points (zoomed in) — one call, one shape switch on `mode`.
 *
 * Geo-only: no text filter here. The B3.1 trigram/tsvector infrastructure is
 * deliberately NOT used by this endpoint (the map canvas filters by viewport,
 * not by words); if a text filter is added later it composes on top of the
 * same WHERE builder in `MapRepository`.
 *
 * Clustering is a deterministic grid: `ST_SnapToGrid(location, cell)` with
 * `cell = 90 / 2^zoom` degrees (≈ a 64px cell at 256px tiles), clusters
 * anchored at the centroid of their member points. Grid clustering (not
 * `ST_ClusterWithin`/DBSCAN) because it is index-friendly, order-stable and
 * zoom-proportional by construction — see DECISIONS B3.4.
 *
 * Results are Redis-cached (60s TTL) keyed by the zoom + cityId + the bbox
 * corners quantized to 3 decimals (~111m) so sub-pixel panning jitter maps to
 * the same cache cell.
 */

/** Zoom at and above which individual points replace clusters. Below it the
 * endpoint answers with grid clusters (cell size grows as you zoom out). */
export const MAP_POINT_ZOOM_MIN = 14;

/** Hard cap on points returned in `points` mode. Above this the client must
 * zoom in (the meta carries `truncated: true` so the UI can hint that). */
export const MAP_MAX_POINTS = 1000;

/** The raw `bbox` query param: `west,south,east,north` (comma-separated
 * decimals). Parsed into the shared `bboxSchema` (order refinements included). */
const rawBboxParamSchema = z
  .string()
  .trim()
  .min(7) // shortest legal value: "0,0,0,0" minus leading "-"... "-1,-1,0,0" is 9; keep 7 as floor
  .max(100)
  .refine(
    (s) => {
      const parts = s.split(',');
      return parts.length === 4 && parts.every((p) => p.trim().length > 0);
    },
    { message: 'bbox must be west,south,east,north (4 comma-separated decimals)' },
  );

/** The map query. `zoom` is the MapLibre zoom (integer 1–22, default 14 =
 * points); `cityId` optionally scopes the viewport to one city. */
export const mapQuerySchema = z
  .object({
    bbox: rawBboxParamSchema
      .transform((raw) => {
        const [west, south, east, north] = raw.split(',').map((p) => Number(p.trim()));
        return { west, south, east, north };
      })
      .pipe(bboxSchema),
    zoom: z.coerce.number().int().min(1).max(22).default(14),
    cityId: uuidSchema.optional(),
  })
  .strict();
export type MapQuery = z.infer<typeof mapQuerySchema>;

/**
 * One business point (points mode). Deliberately leaner than `SearchHit` —
 * a viewport can hold hundreds of markers and the popup fetches the full
 * detail (`GET /businesses/:idOrSlug`) on demand. `primaryCategorySlug` lets
 * the client pick the marker icon per category.
 */
export const mapPointSchema = z
  .object({
    id: uuidSchema,
    slug: z.string().min(1).max(80),
    name: z.string().min(1).max(200),
    primaryCategorySlug: z.string().min(1).max(80),
    location: geoPointSchema,
    avgRating: z.number().min(0).max(5),
    reviewCount: z.number().int().min(0),
    isFeatured: z.boolean(),
  })
  .strict();
export type MapPoint = z.infer<typeof mapPointSchema>;

/** One grid cluster (clusters mode): the centroid of its member points and
 * how many members it covers. The client renders a size-proportional marker. */
export const mapClusterSchema = z
  .object({
    location: geoPointSchema,
    count: z.number().int().min(1),
  })
  .strict();
export type MapCluster = z.infer<typeof mapClusterSchema>;

/** Shared response meta: the (resolved) zoom, the total number of matching
 * businesses in the bbox (both modes) and whether points-mode output was
 * capped (`MAP_MAX_POINTS`) — clusters are never truncated. */
export const mapMetaSchema = z
  .object({
    zoom: z.number().int().min(1).max(22),
    total: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();
export type MapMeta = z.infer<typeof mapMetaSchema>;

/** Discriminated response: switch on `mode` to render. */
export const mapResultSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('clusters'),
      items: z.array(mapClusterSchema),
      meta: mapMetaSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('points'),
      items: z.array(mapPointSchema),
      meta: mapMetaSchema,
    })
    .strict(),
]);
export type MapResult = z.infer<typeof mapResultSchema>;

/** The query the service hands the repository: bbox already parsed into
 * numbers, the mode resolved from the zoom, the grid cell size computed and
 * the points cap fixed. The repository treats this as opaque input. */
export interface NormalizedMapQuery {
  bbox: Bbox;
  zoom: number;
  mode: 'clusters' | 'points';
  /** Grid cell in degrees (zoom-proportional, `90 / 2^zoom`); used only in
   * clusters mode. */
  cellDeg: number;
  cityId?: string;
  pointLimit: number;
}

/** Re-export the geo primitives this contract leans on so map consumers can
 * import everything from one module. */
export { bboxSchema, geoPointSchema, longitudeSchema, latitudeSchema, type Bbox };
