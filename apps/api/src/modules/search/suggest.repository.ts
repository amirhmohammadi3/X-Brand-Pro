import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql, or, ilike } from 'drizzle-orm';
import type { NormalizedSuggestQuery, SuggestHit, SuggestKind } from '@app/contracts';
import { businesses, cities, neighborhoods, categories } from '../../db/schema/index.js';
import { DrizzleClient } from '../../db/drizzle.client.js';

/**
 * Suggest repository (B3.3) — the SQL layer for `GET /api/v1/search/suggest`.
 * One method per scope, each building a trigram-indexed prefix query over the
 * B3.1 `name_normalized` (businesses) or `name_fa` (catalog/geo) columns.
 *
 * Matching strategy: `name ILIKE 'prefix%'` is the primary filter — a leading-
 * constant ILIKE uses the GIN trigram index (`gin_trgm_ops`) for fast lookups.
 * `similarity(name, prefix)` provides the ranking score (0–1); prefix matches
 * naturally score high. The prefix is normalised + SQL-wildcard-escaped upstream
 * by `SuggestService.normalize`, so the ILIKE pattern is a literal prefix.
 *
 * Only `active`, non-soft-deleted businesses and `is_active` catalog/geo rows
 * are returned (public suggest). Each method returns a bounded list (the
 * service caps the merged `all` result to `limit`).
 */
@Injectable()
export class SuggestRepository {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async suggestBusinesses(q: NormalizedSuggestQuery): Promise<SuggestHit[]> {
    const pattern = `${q.prefix}%`;
    const conds = [
      eq(businesses.status, 'active'),
      isNull(businesses.deletedAt),
      or(
        ilike(businesses.nameNormalized, pattern),
        sql`${businesses.nameNormalized} % ${q.prefix}`,
      ),
    ];
    if (q.cityId) conds.push(eq(businesses.cityId, q.cityId));
    const rows = await this.client.db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        label: businesses.name,
        labelAlt: businesses.nameAlt,
        sublabel: cities.name,
        score: sql<number>`similarity(${businesses.nameNormalized}, ${q.prefix})::double precision`,
      })
      .from(businesses)
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .where(and(...conds))
      .orderBy(
        sql`(CASE WHEN ${businesses.nameNormalized} ILIKE ${pattern} THEN 1 ELSE 0 END) DESC`,
        sql`similarity(${businesses.nameNormalized}, ${q.prefix}) DESC`,
        sql`${businesses.avgRating} DESC`,
        businesses.id,
      )
      .limit(q.limit);
    return rows.map((r) => this.toHit('business', r));
  }

  async suggestCategories(q: NormalizedSuggestQuery): Promise<SuggestHit[]> {
    const pattern = `${q.prefix}%`;
    const rows = await this.client.db
      .select({
        id: categories.id,
        slug: categories.slug,
        label: categories.nameFa,
        labelAlt: sql<string>`null::text`,
        sublabel: sql<string>`null::text`,
        score: sql<number>`similarity(${categories.nameFa}, ${q.prefix})::double precision`,
      })
      .from(categories)
      .where(
        and(
          eq(categories.isActive, true),
          or(ilike(categories.nameFa, pattern), sql`${categories.nameFa} % ${q.prefix}`),
        ),
      )
      .orderBy(
        sql`(CASE WHEN ${categories.nameFa} ILIKE ${pattern} THEN 1 ELSE 0 END) DESC`,
        sql`similarity(${categories.nameFa}, ${q.prefix}) DESC`,
        categories.sortOrder,
        categories.id,
      )
      .limit(q.limit);
    return rows.map((r) => this.toHit('category', r));
  }

  async suggestNeighborhoods(q: NormalizedSuggestQuery): Promise<SuggestHit[]> {
    const pattern = `${q.prefix}%`;
    const conds = [
      eq(neighborhoods.isActive, true),
      or(ilike(neighborhoods.nameFa, pattern), sql`${neighborhoods.nameFa} % ${q.prefix}`),
    ];
    if (q.cityId) conds.push(eq(neighborhoods.cityId, q.cityId));
    const rows = await this.client.db
      .select({
        id: neighborhoods.id,
        slug: neighborhoods.slug,
        label: neighborhoods.nameFa,
        labelAlt: sql<string>`null::text`,
        sublabel: cities.name,
        score: sql<number>`similarity(${neighborhoods.nameFa}, ${q.prefix})::double precision`,
      })
      .from(neighborhoods)
      .innerJoin(cities, eq(cities.id, neighborhoods.cityId))
      .where(and(...conds))
      .orderBy(
        sql`(CASE WHEN ${neighborhoods.nameFa} ILIKE ${pattern} THEN 1 ELSE 0 END) DESC`,
        sql`similarity(${neighborhoods.nameFa}, ${q.prefix}) DESC`,
        neighborhoods.sortOrder,
        neighborhoods.id,
      )
      .limit(q.limit);
    return rows.map((r) => this.toHit('neighborhood', r));
  }

  async suggestCities(q: NormalizedSuggestQuery): Promise<SuggestHit[]> {
    const pattern = `${q.prefix}%`;
    const rows = await this.client.db
      .select({
        id: cities.id,
        slug: cities.slug,
        label: cities.nameFa,
        labelAlt: sql<string>`null::text`,
        sublabel: sql<string>`null::text`,
        score: sql<number>`similarity(${cities.nameFa}, ${q.prefix})::double precision`,
      })
      .from(cities)
      .where(
        and(
          eq(cities.isActive, true),
          or(ilike(cities.nameFa, pattern), sql`${cities.nameFa} % ${q.prefix}`),
        ),
      )
      .orderBy(
        sql`(CASE WHEN ${cities.nameFa} ILIKE ${pattern} THEN 1 ELSE 0 END) DESC`,
        sql`similarity(${cities.nameFa}, ${q.prefix}) DESC`,
        cities.sortOrder,
        cities.id,
      )
      .limit(q.limit);
    return rows.map((r) => this.toHit('city', r));
  }

  /** Map a raw row to a SuggestHit. `label`/`labelAlt`/`sublabel` come from the
   * query; `sublabel` for catalog/city scopes is `null::text` (no parent to
   * name). The jsonb `cities.name` / `neighborhoods` parent name arrives as a
   * Record — `pickLocalized` would need a locale; suggest returns the whole map
   * and the client picks, but the contract says `sublabel: string | null`, so
   * we extract `fa` (always present per the `name ? 'fa'` CHECK). */
  private toHit(
    kind: SuggestKind,
    r: {
      id: string;
      slug: string;
      label: string | null;
      labelAlt: string | null;
      sublabel: unknown;
      score: unknown;
    },
  ): SuggestHit {
    const sublabel = this.extractFa(r.sublabel);
    return {
      kind,
      id: r.id,
      slug: r.slug,
      label: r.label ?? '',
      labelAlt: r.labelAlt,
      sublabel,
      score: r.score === null ? 0 : Number(r.score),
    };
  }

  /** Pull the Persian string out of a jsonb localized-name column or `null::text`. */
  private extractFa(v: unknown): string | null {
    if (v === null) return null;
    if (typeof v === 'string') return v.length > 0 ? v : null;
    if (typeof v === 'object' && v !== null && 'fa' in v) {
      const fa = (v as Record<string, unknown>).fa;
      return typeof fa === 'string' && fa.length > 0 ? fa : null;
    }
    return null;
  }
}
