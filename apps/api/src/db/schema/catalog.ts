import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Hierarchical business categories (B2.2) — a two-level tree. A root has
 * `parent_id = null`; a child points at its parent. The depth rule (a child
 * may not have children) is enforced in the service, NOT by a DB constraint
 * (a deferred check is not required by the prompt).
 *
 * `name` is a localized map with a CHECK `name ? 'fa'` (Persian fallback
 * required). `description` is a localized map too but `fa` is optional there.
 * `icon` is a Lucide name (validated against `CATEGORY_ICONS` at the API
 * boundary; default `store`). `color` is a semantic accent slot
 * (`accent-1..8`) — never raw hex, so themes stay contrast-safe. `kind`
 * decides what the business page shows (menu / services / none).
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),
    slug: text('slug').notNull().unique(),
    name: jsonb('name').notNull().$type<Record<string, string>>(),
    // B3.1: derived Persian display name for trigram-backed auto-suggest.
    nameFa: text('name_fa').generatedAlwaysAs(sql`name ->> 'fa'`),
    description: jsonb('description').$type<Record<string, string> | null>(),
    icon: text('icon').notNull().default('store'),
    color: text('color'),
    kind: text('kind').notNull().default('none'),
    supportsReservation: boolean('supports_reservation').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Self-FK declared via foreignKey() (referencing table.id, not the
    // `categories` const) so the table's type inference is not circular.
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'categories_parent_id_categories_id_fk',
    }).onDelete('restrict'),
    index('categories_parent_sort_idx').on(table.parentId, table.sortOrder),
    // B3.1: trigram index on the Persian name for prefix/fuzzy category suggest.
    index('categories_name_fa_trgm_idx').using('gin', sql`${table.nameFa} gin_trgm_ops`),
    check('categories_name_has_fa', sql`${table.name} ? 'fa'`),
    check('categories_kind_enum', sql`${table.kind} in ('menu', 'services', 'none')`),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;

/**
 * Amenities (B2.3) — features such as Wi-Fi, parking, outdoor seating. Flat
 * catalog (no hierarchy) with translations + an icon + a group. `name` is a
 * localized map with CHECK `name ? 'fa'`. Linked to categories through
 * `category_amenities` (a category inherits its parent's amenities in the
 * public endpoint, computed in the service).
 */
export const amenities = pgTable(
  'amenities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: jsonb('name').notNull().$type<Record<string, string>>(),
    // B3.1: derived Persian display name for trigram-backed auto-suggest.
    nameFa: text('name_fa').generatedAlwaysAs(sql`name ->> 'fa'`),
    icon: text('icon').notNull().default('wifi'),
    group: text('group').notNull().default('general'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('amenities_name_has_fa', sql`${table.name} ? 'fa'`),
    // B3.1: trigram index on the Persian name for prefix/fuzzy amenity suggest.
    index('amenities_name_fa_trgm_idx').using('gin', sql`${table.nameFa} gin_trgm_ops`),
    check(
      'amenities_group_enum',
      sql`${table.group} in ('general','food','payment','accessibility','family','comfort')`,
    ),
  ],
);

/**
 * Category ↔ amenity mapping (B2.3). Composite PK (category_id, amenity_id);
 * both FKs cascade. `sort_order` orders amenities within a category for the
 * public endpoint (then by group).
 */
export const categoryAmenities = pgTable(
  'category_amenities',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    amenityId: uuid('amenity_id')
      .notNull()
      .references(() => amenities.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // composite primary key (category_id, amenity_id)
    primaryKey({ columns: [table.categoryId, table.amenityId], name: 'category_amenities_pk' }),
    index('category_amenities_category_sort_idx').on(table.categoryId, table.sortOrder),
  ],
);

export type AmenityRow = typeof amenities.$inferSelect;
export type NewAmenityRow = typeof amenities.$inferInsert;
export type CategoryAmenityRow = typeof categoryAmenities.$inferSelect;
