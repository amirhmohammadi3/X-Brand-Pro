import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * PostGIS `geography(Point, 4326)` column type (B2.1). Drizzle has no built-in
 * PostGIS type, so `customType` declares the column DDL for drizzle-kit. The
 * repository writes points with `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`
 * and reads them with `ST_Y(center::geometry)` / `ST_X(center::geometry)`; the
 * row's `center` field is therefore opaque (`unknown`) and never used directly.
 */
export const geographyPoint = customType<{ data: unknown; default: undefined }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
});

/** Bounding box stored as jsonb alongside the center point. */
export type BboxRow = { west: number; south: number; east: number; north: number };

/**
 * Cities (B2.1). `name` is a localized map (`{ fa: 'تهران', en: 'Tehran' }`);
 * the `name ? 'fa'` CHECK guarantees the Persian fallback always exists.
 * `center` is a PostGIS geography point with a GiST index for spatial queries
 * (search/map in later phases). `is_active` gates public visibility; admin
 * reads see all rows.
 */
export const cities = pgTable(
  'cities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: jsonb('name').notNull().$type<Record<string, string>>(),
    // B3.1: derived Persian display name for trigram-backed auto-suggest. The
    // `name ? 'fa'` CHECK guarantees `fa` exists, so `name->>'fa'` never yields
    // NULL for a valid row.
    nameFa: text('name_fa').generatedAlwaysAs(sql`name ->> 'fa'`),
    center: geographyPoint('center').notNull(),
    bbox: jsonb('bbox').$type<BboxRow | null>(),
    timezone: text('timezone').notNull().default('Asia/Tehran'),
    isActive: boolean('is_active').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cities_center_idx').using('gist', table.center),
    // B3.1: trigram index on the Persian name for prefix/fuzzy city suggest.
    index('cities_name_fa_trgm_idx').using('gin', sql`${table.nameFa} gin_trgm_ops`),
    check('cities_name_has_fa', sql`${table.name} ? 'fa'`),
  ],
);

/**
 * Neighborhoods (B2.1). Scoped to a city (`city_id` cascades on city delete);
 * `(city_id, slug)` is unique so two cities may reuse a slug. Same `name ? 'fa'`
 * CHECK and GiST center index as cities.
 */
export const neighborhoods = pgTable(
  'neighborhoods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: jsonb('name').notNull().$type<Record<string, string>>(),
    // B3.1: derived Persian display name for trigram-backed auto-suggest.
    nameFa: text('name_fa').generatedAlwaysAs(sql`name ->> 'fa'`),
    center: geographyPoint('center').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('neighborhoods_city_slug_unique').on(table.cityId, table.slug),
    index('neighborhoods_center_idx').using('gist', table.center),
    // B3.1: trigram index on the Persian name for prefix/fuzzy neighborhood suggest.
    index('neighborhoods_name_fa_trgm_idx').using('gin', sql`${table.nameFa} gin_trgm_ops`),
    check('neighborhoods_name_has_fa', sql`${table.name} ? 'fa'`),
  ],
);

export type CityRow = typeof cities.$inferSelect;
export type NewCityRow = typeof cities.$inferInsert;
export type NeighborhoodRow = typeof neighborhoods.$inferSelect;
export type NewNeighborhoodRow = typeof neighborhoods.$inferInsert;
