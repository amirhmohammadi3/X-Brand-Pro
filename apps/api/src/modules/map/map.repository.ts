import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Bbox, MapCluster, MapPoint, NormalizedMapQuery } from '@app/contracts';
import { businesses, categories } from '../../db/schema/index.js';
import { DrizzleClient } from '../../db/drizzle.client.js';

/**
 * Map repository (B3.4) — the SQL layer for `GET /api/v1/map/businesses`.
 * Geo-only: every query filters by viewport bbox (+ optional city), never by
 * text — the B3.1 trigram/tsvector machinery is intentionally not involved.
 * All user input reaches the database through Drizzle `sql` parameter
 * placeholders — never string concatenation.
 *
 * Bbox filtering is a two-part predicate:
 * 1. `location && ST_MakeEnvelope(...)::geography` — the `&&` bounding-box
 *    operator between two geographies drives the `businesses_location_idx`
 *    (GiST) index scan, so the query never degrades to a seq scan even for a
 *    whole-country bbox.
 * 2. `ST_Within(location::geometry, ST_MakeEnvelope(...))` — the exact planar
 *    containment test, applied only to the rows the index scan returned. The
 *    geography `&&` test is a geodesic bounding approximation that can be
 *    slightly more inclusive than the planar envelope (high latitudes), so
 *    the exact filter keeps the result set precisely inside the viewport.
 *
 * Clustering (clusters mode) groups by `ST_SnapToGrid(location::geometry,
 * :cellDeg)` — a deterministic, zoom-proportional grid — and anchors every
 * cluster at the centroid of its actual member points (not the grid cell
 * center), so clusters sit on the real distribution.
 */
@Injectable()
export class MapRepository {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  /** Total number of active, non-deleted businesses inside the bbox (and the
   * optional city). Powers `meta.total` / `meta.truncated` in the response. */
  async countInBbox(bbox: Bbox, cityId?: string): Promise<number> {
    const rows = await this.client.db
      .select({ total: sql<number>`count(*)::int` })
      .from(businesses)
      .where(and(...this.bboxConditions(bbox, cityId)));
    return rows[0]?.total ?? 0;
  }

  /** Grid clusters for the bbox: one row per `ST_SnapToGrid` cell, anchored at
   * the centroid of the cell's member points, ordered by count desc then by
   * anchor (deterministic output for the cache and for tests). */
  async findClusters(q: NormalizedMapQuery): Promise<MapCluster[]> {
    const rows = await this.client.db
      .select({
        lat: sql`ST_Y(ST_Centroid(ST_Collect(${businesses.location}::geometry)))::double precision`.as(
          'lat',
        ),
        lng: sql`ST_X(ST_Centroid(ST_Collect(${businesses.location}::geometry)))::double precision`.as(
          'lng',
        ),
        count: sql<number>`count(*)::int`,
      })
      .from(businesses)
      .where(and(...this.bboxConditions(q.bbox, q.cityId)))
      .groupBy(sql`ST_SnapToGrid(${businesses.location}::geometry, ${q.cellDeg})`)
      .orderBy(sql`count(*) DESC, "lat" ASC, "lng" ASC`);
    return rows.map((r) => ({
      location: { lat: Number(r.lat), lng: Number(r.lng) },
      count: r.count,
    }));
  }

  /** Individual business points for the bbox, capped at `pointLimit` (the
   * service passes `MAP_MAX_POINTS`), best-rated first — when the viewport
   * holds more than the cap the client sees the top businesses and the meta
   * flags `truncated`. `id ASC` is the stable tiebreaker. */
  async findPoints(q: NormalizedMapQuery): Promise<MapPoint[]> {
    const rows = await this.client.db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        name: businesses.name,
        primaryCategorySlug: categories.slug,
        lat: sql`ST_Y(${businesses.location}::geometry)::double precision`.as('lat'),
        lng: sql`ST_X(${businesses.location}::geometry)::double precision`.as('lng'),
        avgRating: businesses.avgRating,
        reviewCount: businesses.reviewCount,
        isFeatured: businesses.isFeatured,
      })
      .from(businesses)
      .innerJoin(categories, eq(categories.id, businesses.primaryCategoryId))
      .where(and(...this.bboxConditions(q.bbox, q.cityId)))
      .orderBy(sql`"avg_rating" DESC, "review_count" DESC, "id" ASC`)
      .limit(q.pointLimit);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      primaryCategorySlug: r.primaryCategorySlug,
      location: { lat: Number(r.lat), lng: Number(r.lng) },
      avgRating: Number(r.avgRating),
      reviewCount: r.reviewCount,
      isFeatured: r.isFeatured,
    }));
  }

  /** The shared WHERE builder: active + not soft-deleted (+ city), the GiST
   * index prefilter and the exact planar containment. Every fragment is a
   * parameterised `sql` template. */
  private bboxConditions(bbox: Bbox, cityId?: string) {
    const conditions = [eq(businesses.status, 'active'), isNull(businesses.deletedAt)];
    if (cityId) conditions.push(eq(businesses.cityId, cityId));
    // (1) Index prefilter — geography && geography drives the GiST index.
    conditions.push(
      sql`${businesses.location} && ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326)::geography`,
    );
    // (2) Exact filter — planar containment of the point inside the envelope.
    conditions.push(
      sql`ST_Within(${businesses.location}::geometry, ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326))`,
    );
    return conditions;
  }
}
