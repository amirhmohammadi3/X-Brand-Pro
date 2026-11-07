import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { cities, neighborhoods, type CityRow, type NeighborhoodRow } from '../../db/schema/geo.js';
import type { GeoPoint } from '@app/contracts';

/** DI token for the geo repository (tests bind a fake). */
export const GEO_REPOSITORY = Symbol('GEO_REPOSITORY');

/**
 * All Drizzle access for the geo domain (B2.1). The narrow surface doubles as
 * the fake-able contract for unit tests. PostGIS point columns are written with
 * `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` and read with
 * `ST_Y(center::geometry)` / `ST_X(center::geometry)` (the row's `center` field
 * is opaque binary and never used directly).
 */

/** Center as a SQL value for INSERT. */
function pointValue(c: GeoPoint) {
  return sql`ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography`;
}
/** Latitude read out of the geography column. */
const latExpr = sql`ST_Y(${cities.center}::geometry)::double precision`.as('lat');
/** Longitude read out of the geography column. */
const lngExpr = sql`ST_X(${cities.center}::geometry)::double precision`.as('lng');
const neighLatExpr = sql`ST_Y(${neighborhoods.center}::geometry)::double precision`.as('lat');
const neighLngExpr = sql`ST_X(${neighborhoods.center}::geometry)::double precision`.as('lng');

export interface CityPublicView {
  id: string;
  slug: string;
  name: Record<string, string>;
  center: GeoPoint;
  bbox: { west: number; south: number; east: number; north: number } | null;
  timezone: string;
  isActive: boolean;
  sortOrder: number;
}

export interface NeighborhoodPublicView {
  id: string;
  cityId: string;
  slug: string;
  name: Record<string, string>;
  center: GeoPoint;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateCityInput {
  slug: string;
  name: Record<string, string>;
  center: GeoPoint;
  bbox: { west: number; south: number; east: number; north: number } | null;
  timezone: string;
  isActive: boolean;
  sortOrder: number;
}
export type UpdateCityInput = Partial<CreateCityInput>;

export interface CreateNeighborhoodInput {
  slug: string;
  name: Record<string, string>;
  center: GeoPoint;
  isActive: boolean;
  sortOrder: number;
}
export type UpdateNeighborhoodInput = Partial<CreateNeighborhoodInput>;

export interface GeoRepositoryLike {
  listPublicCities(): Promise<CityPublicView[]>;
  findPublicCityBySlug(slug: string): Promise<CityPublicView | null>;
  listPublicNeighborhoods(cityId: string): Promise<NeighborhoodPublicView[]>;
  listAllNeighborhoodsByCity(cityId: string): Promise<NeighborhoodPublicView[]>;
  listAllCities(): Promise<CityPublicView[]>;
  findCityById(id: string): Promise<CityPublicView | null>;
  findCityBySlug(slug: string): Promise<CityPublicView | null>;
  citySlugExists(slug: string, exceptId?: string): Promise<boolean>;
  countNeighborhoodsByCity(): Promise<Map<string, number>>;
  countNeighborhoodsForCity(cityId: string): Promise<number>;
  createCity(input: CreateCityInput): Promise<CityPublicView>;
  updateCity(id: string, input: UpdateCityInput): Promise<CityPublicView | null>;
  deleteCity(id: string): Promise<void>;
  reorderCities(ids: string[]): Promise<void>;
  findNeighborhoodByCityAndSlug(
    cityId: string,
    slug: string,
  ): Promise<NeighborhoodPublicView | null>;
  findNeighborhoodById(id: string): Promise<NeighborhoodPublicView | null>;
  neighborhoodSlugExists(cityId: string, slug: string, exceptId?: string): Promise<boolean>;
  createNeighborhood(
    cityId: string,
    input: CreateNeighborhoodInput,
  ): Promise<NeighborhoodPublicView>;
  updateNeighborhood(
    id: string,
    input: UpdateNeighborhoodInput,
  ): Promise<NeighborhoodPublicView | null>;
  deleteNeighborhood(id: string): Promise<void>;
  reorderNeighborhoods(cityId: string, ids: string[]): Promise<void>;
}

function rowToCity(r: {
  id: string;
  slug: string;
  name: Record<string, string>;
  lat: unknown;
  lng: unknown;
  bbox: CityRow['bbox'];
  timezone: string;
  isActive: boolean;
  sortOrder: number;
}): CityPublicView {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    center: { lat: Number(r.lat), lng: Number(r.lng) },
    bbox: r.bbox ?? null,
    timezone: r.timezone,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}

function rowToNeighborhood(r: {
  id: string;
  cityId: string;
  slug: string;
  name: Record<string, string>;
  lat: unknown;
  lng: unknown;
  isActive: boolean;
  sortOrder: number;
}): NeighborhoodPublicView {
  return {
    id: r.id,
    cityId: r.cityId,
    slug: r.slug,
    name: r.name,
    center: { lat: Number(r.lat), lng: Number(r.lng) },
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}

const CITY_SELECT = {
  id: cities.id,
  slug: cities.slug,
  name: cities.name,
  lat: latExpr,
  lng: lngExpr,
  bbox: cities.bbox,
  timezone: cities.timezone,
  isActive: cities.isActive,
  sortOrder: cities.sortOrder,
} as const;

const NEIGHBORHOOD_SELECT = {
  id: neighborhoods.id,
  cityId: neighborhoods.cityId,
  slug: neighborhoods.slug,
  name: neighborhoods.name,
  lat: neighLatExpr,
  lng: neighLngExpr,
  isActive: neighborhoods.isActive,
  sortOrder: neighborhoods.sortOrder,
} as const;

@Injectable()
export class GeoRepository implements GeoRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async listPublicCities(): Promise<CityPublicView[]> {
    const rows = await this.client.db
      .select(CITY_SELECT)
      .from(cities)
      .where(eq(cities.isActive, true))
      .orderBy(asc(cities.sortOrder), asc(sql`${cities.name}->>'fa'`), asc(cities.id));
    return rows.map(rowToCity);
  }

  async findPublicCityBySlug(slug: string): Promise<CityPublicView | null> {
    const rows = await this.client.db
      .select(CITY_SELECT)
      .from(cities)
      .where(and(eq(cities.slug, slug), eq(cities.isActive, true)))
      .limit(1);
    return rows[0] ? rowToCity(rows[0]) : null;
  }

  async listPublicNeighborhoods(cityId: string): Promise<NeighborhoodPublicView[]> {
    const rows = await this.client.db
      .select(NEIGHBORHOOD_SELECT)
      .from(neighborhoods)
      .where(and(eq(neighborhoods.cityId, cityId), eq(neighborhoods.isActive, true)))
      .orderBy(
        asc(neighborhoods.sortOrder),
        asc(sql`${neighborhoods.name}->>'fa'`),
        asc(neighborhoods.id),
      );
    return rows.map(rowToNeighborhood);
  }

  async listAllNeighborhoodsByCity(cityId: string): Promise<NeighborhoodPublicView[]> {
    const rows = await this.client.db
      .select(NEIGHBORHOOD_SELECT)
      .from(neighborhoods)
      .where(eq(neighborhoods.cityId, cityId))
      .orderBy(
        asc(neighborhoods.sortOrder),
        asc(sql`${neighborhoods.name}->>'fa'`),
        asc(neighborhoods.id),
      );
    return rows.map(rowToNeighborhood);
  }

  async listAllCities(): Promise<CityPublicView[]> {
    const rows = await this.client.db
      .select(CITY_SELECT)
      .from(cities)
      .orderBy(asc(cities.sortOrder), asc(sql`${cities.name}->>'fa'`), asc(cities.id));
    return rows.map(rowToCity);
  }

  async findCityById(id: string): Promise<CityPublicView | null> {
    const rows = await this.client.db
      .select(CITY_SELECT)
      .from(cities)
      .where(eq(cities.id, id))
      .limit(1);
    return rows[0] ? rowToCity(rows[0]) : null;
  }

  async findCityBySlug(slug: string): Promise<CityPublicView | null> {
    const rows = await this.client.db
      .select(CITY_SELECT)
      .from(cities)
      .where(eq(cities.slug, slug))
      .limit(1);
    return rows[0] ? rowToCity(rows[0]) : null;
  }

  async citySlugExists(slug: string, exceptId?: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: cities.id })
      .from(cities)
      .where(
        exceptId
          ? and(eq(cities.slug, slug), sql`${cities.id} <> ${exceptId}`)
          : eq(cities.slug, slug),
      )
      .limit(1);
    return rows.length > 0;
  }

  async countNeighborhoodsByCity(): Promise<Map<string, number>> {
    const rows = await this.client.db
      .select({ cityId: neighborhoods.cityId, count: sql<number>`count(*)::int` })
      .from(neighborhoods)
      .groupBy(neighborhoods.cityId);
    return new Map(rows.map((r) => [r.cityId, r.count]));
  }

  async countNeighborhoodsForCity(cityId: string): Promise<number> {
    const rows = await this.client.db
      .select({ count: sql<number>`count(*)::int` })
      .from(neighborhoods)
      .where(eq(neighborhoods.cityId, cityId));
    return rows[0]?.count ?? 0;
  }

  async createCity(input: CreateCityInput): Promise<CityPublicView> {
    const rows = await this.client.db
      .insert(cities)
      .values({
        slug: input.slug,
        name: input.name,
        center: pointValue(input.center),
        bbox: input.bbox,
        timezone: input.timezone,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      })
      .returning({
        id: cities.id,
        slug: cities.slug,
        name: cities.name,
        lat: latExpr,
        lng: lngExpr,
        bbox: cities.bbox,
        timezone: cities.timezone,
        isActive: cities.isActive,
        sortOrder: cities.sortOrder,
      });
    const row = rows[0];
    if (!row) throw new Error('cities insert returned no row');
    return rowToCity(row);
  }

  async updateCity(id: string, input: UpdateCityInput): Promise<CityPublicView | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = input.name;
    if (input.center !== undefined) set.center = pointValue(input.center);
    if (input.bbox !== undefined) set.bbox = input.bbox;
    if (input.timezone !== undefined) set.timezone = input.timezone;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    const rows = await this.client.db.update(cities).set(set).where(eq(cities.id, id)).returning({
      id: cities.id,
      slug: cities.slug,
      name: cities.name,
      lat: latExpr,
      lng: lngExpr,
      bbox: cities.bbox,
      timezone: cities.timezone,
      isActive: cities.isActive,
      sortOrder: cities.sortOrder,
    });
    return rows[0] ? rowToCity(rows[0]) : null;
  }

  async deleteCity(id: string): Promise<void> {
    await this.client.db.delete(cities).where(eq(cities.id, id));
  }

  async reorderCities(ids: string[]): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      let i = 0;
      for (const id of ids) {
        await tx
          .update(cities)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(eq(cities.id, id));
        i++;
      }
    });
  }

  async findNeighborhoodByCityAndSlug(
    cityId: string,
    slug: string,
  ): Promise<NeighborhoodPublicView | null> {
    const rows = await this.client.db
      .select(NEIGHBORHOOD_SELECT)
      .from(neighborhoods)
      .where(and(eq(neighborhoods.cityId, cityId), eq(neighborhoods.slug, slug)))
      .limit(1);
    return rows[0] ? rowToNeighborhood(rows[0]) : null;
  }

  async findNeighborhoodById(id: string): Promise<NeighborhoodPublicView | null> {
    const rows = await this.client.db
      .select(NEIGHBORHOOD_SELECT)
      .from(neighborhoods)
      .where(eq(neighborhoods.id, id))
      .limit(1);
    return rows[0] ? rowToNeighborhood(rows[0]) : null;
  }

  async neighborhoodSlugExists(cityId: string, slug: string, exceptId?: string): Promise<boolean> {
    const conds = [eq(neighborhoods.cityId, cityId), eq(neighborhoods.slug, slug)];
    if (exceptId) conds.push(sql`${neighborhoods.id} <> ${exceptId}`);
    const rows = await this.client.db
      .select({ id: neighborhoods.id })
      .from(neighborhoods)
      .where(and(...conds))
      .limit(1);
    return rows.length > 0;
  }

  async createNeighborhood(
    cityId: string,
    input: CreateNeighborhoodInput,
  ): Promise<NeighborhoodPublicView> {
    const rows = await this.client.db
      .insert(neighborhoods)
      .values({
        cityId,
        slug: input.slug,
        name: input.name,
        center: pointValue(input.center),
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      })
      .returning({
        id: neighborhoods.id,
        cityId: neighborhoods.cityId,
        slug: neighborhoods.slug,
        name: neighborhoods.name,
        lat: neighLatExpr,
        lng: neighLngExpr,
        isActive: neighborhoods.isActive,
        sortOrder: neighborhoods.sortOrder,
      });
    const row = rows[0];
    if (!row) throw new Error('neighborhoods insert returned no row');
    return rowToNeighborhood(row);
  }

  async updateNeighborhood(
    id: string,
    input: UpdateNeighborhoodInput,
  ): Promise<NeighborhoodPublicView | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = input.name;
    if (input.center !== undefined) set.center = pointValue(input.center);
    if (input.isActive !== undefined) set.isActive = input.isActive;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    const rows = await this.client.db
      .update(neighborhoods)
      .set(set)
      .where(eq(neighborhoods.id, id))
      .returning({
        id: neighborhoods.id,
        cityId: neighborhoods.cityId,
        slug: neighborhoods.slug,
        name: neighborhoods.name,
        lat: neighLatExpr,
        lng: neighLngExpr,
        isActive: neighborhoods.isActive,
        sortOrder: neighborhoods.sortOrder,
      });
    return rows[0] ? rowToNeighborhood(rows[0]) : null;
  }

  async deleteNeighborhood(id: string): Promise<void> {
    await this.client.db.delete(neighborhoods).where(eq(neighborhoods.id, id));
  }

  async reorderNeighborhoods(cityId: string, ids: string[]): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      let i = 0;
      for (const id of ids) {
        await tx
          .update(neighborhoods)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(and(eq(neighborhoods.id, id), eq(neighborhoods.cityId, cityId)));
        i++;
      }
    });
  }
}

// Re-export the row types for callers that need them.
export type { CityRow, NeighborhoodRow };
