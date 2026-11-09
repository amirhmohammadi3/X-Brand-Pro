import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NormalizedSearchQuery, SearchHit } from '@app/contracts';
import {
  businesses,
  cities,
  neighborhoods,
  categories,
  mediaFiles,
} from '../../db/schema/index.js';
import { DrizzleClient } from '../../db/drizzle.client.js';
// MediaUrlService is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';

/**
 * Search repository (B3.2) — the SQL layer for `GET /api/v1/search`. Builds a
 * single parameterised query against the B3.1 search infrastructure
 * (`businesses.search_vector` tsvector + GIN, `name_normalized` trigram, the
 * PostGIS `location` GiST index). All user input reaches the database through
 * Drizzle `sql` parameter placeholders — never string concatenation.
 *
 * Only `active`, non-soft-deleted businesses are returned (public search). The
 * facet filters compose with AND; the text match uses `plainto_tsquery('simple',
 * :q)` so multi-word user input is AND-joined without requiring the user to
 * know `&`/`|` syntax. `rank` is `ts_rank(search_vector, query)` (0 when no `q`);
 * `distance` is `ST_Distance` from the optional geo origin (null when none).
 */
@Injectable()
export class SearchRepository {
  constructor(
    @Inject(DrizzleClient) private readonly client: DrizzleClient,
    private readonly mediaUrl: MediaUrlService,
  ) {}

  async searchBusinesses(q: NormalizedSearchQuery): Promise<{ items: SearchHit[]; total: number }> {
    // Build the dynamic WHERE clause from the optional filters. Every fragment
    // is a parameterised `sql` template; the `and(...)` reduces to TRUE when
    // empty (returns all active rows).
    const conditions = [eq(businesses.status, 'active'), isNull(businesses.deletedAt)];

    if (q.q) {
      // plainto_tsquery AND-joins the terms and is safe for arbitrary user text
      // (unlike to_tsquery, which would throw on bare words).
      conditions.push(sql`${businesses.searchVector} @@ plainto_tsquery('simple', ${q.q})`);
    }
    if (q.cityId) conditions.push(eq(businesses.cityId, q.cityId));
    if (q.neighborhoodId) conditions.push(eq(businesses.neighborhoodId, q.neighborhoodId));
    if (q.categoryIds?.length) {
      conditions.push(
        sql`${businesses.id} IN (SELECT business_id FROM business_categories WHERE category_id = ANY(${q.categoryIds}::uuid[]))`,
      );
    }
    if (q.amenityIds?.length) {
      conditions.push(
        sql`${businesses.id} IN (SELECT business_id FROM business_amenities WHERE amenity_id = ANY(${q.amenityIds}::uuid[]))`,
      );
    }
    if (q.tags?.length) {
      conditions.push(sql`${businesses.tags} && ${q.tags}::text[]`);
    }
    if (q.priceLevel !== undefined) conditions.push(eq(businesses.priceLevel, q.priceLevel));
    if (q.minRating !== undefined) {
      conditions.push(sql`${businesses.avgRating} >= ${q.minRating}::numeric(3,2)`);
    }
    // Geo radius filter (ST_DWithin uses the GiST index). The origin is also
    // reused for the distance expression + distance sort below.
    const hasOrigin = q.lat !== undefined && q.lng !== undefined;
    if (hasOrigin && q.radius !== undefined) {
      conditions.push(
        sql`ST_DWithin(${businesses.location}, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${q.radius})`,
      );
    }

    const where = and(...conditions);

    // Computed SELECT columns: distance from origin (null when none) and the
    // ts_rank score (0 when no text query — coalesce keeps the column stable).
    const distanceExpr = hasOrigin
      ? sql`ST_Distance(${businesses.location}, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography)::double precision`.as(
          'distance',
        )
      : sql`NULL::double precision`.as('distance');
    const rankExpr = q.q
      ? sql`ts_rank(${businesses.searchVector}, plainto_tsquery('simple', ${q.q}))::double precision`.as(
          'rank',
        )
      : sql`0::double precision`.as('rank');

    // ORDER BY. `sql.raw` is safe here — `orderSql` is one of four known
    // literals derived from the validated `sort` enum, never user text. The
    // stable `id` tiebreaker is always appended (AGENTS.md §6 stable sort).
    const orderSql = this.orderBySql(q.sort, hasOrigin);

    const rows = await this.client.db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        name: businesses.name,
        nameAlt: businesses.nameAlt,
        primaryCategoryId: businesses.primaryCategoryId,
        primaryCategorySlug: categories.slug,
        primaryCategoryName: categories.name,
        cityId: businesses.cityId,
        citySlug: cities.slug,
        cityName: cities.name,
        neighborhoodId: businesses.neighborhoodId,
        address: businesses.address,
        lat: sql`ST_Y(${businesses.location}::geometry)::double precision`.as('lat'),
        lng: sql`ST_X(${businesses.location}::geometry)::double precision`.as('lng'),
        priceLevel: businesses.priceLevel,
        avgRating: businesses.avgRating,
        reviewCount: businesses.reviewCount,
        coverMediaKey: mediaFiles.key,
        coverMediaThumbKey: mediaFiles.thumbKey,
        isFeatured: businesses.isFeatured,
        distance: distanceExpr,
        rank: rankExpr,
      })
      .from(businesses)
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .innerJoin(categories, eq(categories.id, businesses.primaryCategoryId))
      .leftJoin(neighborhoods, eq(neighborhoods.id, businesses.neighborhoodId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, businesses.coverMediaId))
      .where(where)
      .orderBy(sql.raw(orderSql))
      .limit(q.limit)
      .offset(q.offset);

    // Total count for pagination meta — same WHERE, no ORDER/LIMIT.
    const countRows = await this.client.db
      .select({ total: sql<number>`count(*)::int` })
      .from(businesses)
      .where(where);
    const total = countRows[0]?.total ?? 0;

    return { items: rows.map((r) => this.toHit(r)), total };
  }

  /** Map a raw row to a SearchHit. `avgRating` is numeric(3,2) → string until
   * cast to a number; cover/thumb URLs go through MediaUrlService. */
  private toHit(r: {
    id: string;
    slug: string;
    name: string;
    nameAlt: string | null;
    primaryCategoryId: string;
    primaryCategorySlug: string;
    primaryCategoryName: Record<string, string>;
    cityId: string;
    citySlug: string;
    cityName: Record<string, string>;
    neighborhoodId: string | null;
    address: string;
    lat: unknown;
    lng: unknown;
    priceLevel: number | null;
    avgRating: string;
    reviewCount: number;
    coverMediaKey: string | null;
    coverMediaThumbKey: string | null;
    isFeatured: boolean;
    distance: unknown;
    rank: unknown;
  }): SearchHit {
    const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
    const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
    const distance = r.distance === null ? null : Number(r.distance);
    const rank = r.rank === null ? 0 : Number(r.rank);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      nameAlt: r.nameAlt,
      primaryCategoryId: r.primaryCategoryId,
      primaryCategorySlug: r.primaryCategorySlug,
      primaryCategoryName: r.primaryCategoryName,
      cityId: r.cityId,
      citySlug: r.citySlug,
      cityName: r.cityName,
      neighborhoodId: r.neighborhoodId,
      address: r.address,
      location: { lat, lng },
      priceLevel: r.priceLevel,
      avgRating: Number(r.avgRating),
      reviewCount: r.reviewCount,
      coverUrl: this.mediaUrl.urlFor(r.coverMediaKey),
      thumbUrl: this.mediaUrl.urlFor(r.coverMediaThumbKey ?? r.coverMediaKey),
      isFeatured: r.isFeatured,
      distance,
      rank,
    };
  }

  /** Build the ORDER BY SQL fragment for the chosen sort mode. The `id`
   * tiebreaker is always appended so pagination is stable. */
  private orderBySql(sort: NormalizedSearchQuery['sort'], hasOrigin: boolean): string {
    switch (sort) {
      case 'relevance':
        // rank DESC first (a name hit beats a description hit), then rating,
        // then id. NULLS LAST keeps rank-0 rows below ranked ones.
        return `"rank" DESC NULLS LAST, "avg_rating" DESC, "id" ASC`;
      case 'rating':
        return `"avg_rating" DESC, "review_count" DESC, "id" ASC`;
      case 'distance':
        // hasOrigin is enforced by the schema refine(); guard anyway.
        return hasOrigin
          ? `"distance" ASC NULLS LAST, "avg_rating" DESC, "id" ASC`
          : `"avg_rating" DESC, "id" ASC`;
      case 'newest':
        return `"created_at" DESC, "id" ASC`;
      default:
        return `"id" ASC`;
    }
  }
}

// Suppress unused-import lint for asc/desc — kept for future Drizzle-native
// orderBy migrations without re-importing.
// (Removed: asc/desc no longer imported — the orderBy uses sql.raw with known
// sort literals, which is parameter-safe.)
