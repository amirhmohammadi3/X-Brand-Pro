import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geographyPoint, cities, neighborhoods } from './geo.js';
import { categories, amenities } from './catalog.js';
import { mediaFiles } from './media.js';
import { users } from './users.js';

/**
 * Businesses (B2.4) — the core catalog entity. A real-world named place
 * located by a PostGIS point, owned by a user, lifecycle-managed through a
 * status state machine (see BusinessDomainService.canTransition).
 *
 * `name` is a SINGLE string in the owner's own spelling (any script); `nameAlt`
 * carries the second script. Businesses are real-world named entities, not
 * translatable copy — see DECISIONS B2.4. Contacts (phone/whatsapp/telegram/
 * instagram/website/email) are normalised at the edge (contracts/business.ts)
 * and stored in their normalised form.
 *
 * Soft delete (`deleted_at`) keeps rows for audit/SEO redirect; the partial
 * `active` index powers the public city rating leaderboard. `published_at` is
 * set when a business goes `active` and the CHECK `status <> 'active' or
 * published_at is not null` makes an active-without-publish row impossible.
 */
export const businessStatusEnum = pgEnum('business_status', [
  'draft',
  'pending',
  'active',
  'suspended',
  'rejected',
  'closed',
]);

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    nameAlt: text('name_alt'),
    description: text('description'),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    neighborhoodId: uuid('neighborhood_id').references(() => neighborhoods.id, {
      onDelete: 'set null',
    }),
    primaryCategoryId: uuid('primary_category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    address: text('address').notNull(),
    location: geographyPoint('location').notNull(),
    priceLevel: smallint('price_level'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    telegram: text('telegram'),
    instagram: text('instagram'),
    website: text('website'),
    email: text('email'),
    status: businessStatusEnum('status').notNull().default('pending'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    isClaimed: boolean('is_claimed').notNull().default(false),
    isFeatured: boolean('is_featured').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    avgRating: numeric('avg_rating', { precision: 3, scale: 2 }).notNull().default('0'),
    reviewCount: integer('review_count').notNull().default(0),
    coverMediaId: uuid('cover_media_id').references(() => mediaFiles.id, {
      onDelete: 'set null',
    }),
    tags: text('tags').array().notNull().default([]),
    source: text('source').notNull().default('manual'),
    rejectionReason: text('rejection_reason'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('businesses_location_idx').using('gist', table.location),
    index('businesses_city_status_cat_idx').on(table.cityId, table.status, table.primaryCategoryId),
    index('businesses_neighborhood_idx').on(table.neighborhoodId),
    index('businesses_owner_idx').on(table.ownerId),
    index('businesses_status_created_idx').on(table.status, table.createdAt.desc()),
    uniqueIndex('businesses_active_city_rating_idx')
      .on(table.cityId, table.avgRating.desc())
      .where(sql`status = 'active' and deleted_at is null`),
    check('businesses_avg_rating_range', sql`${table.avgRating} between 0 and 5`),
    check('businesses_review_count_nonneg', sql`${table.reviewCount} >= 0`),
    check(
      'businesses_active_requires_published',
      sql`${table.status} <> 'active' or ${table.publishedAt} is not null`,
    ),
    check('businesses_source_enum', sql`${table.source} in ('manual', 'import')`),
  ],
);

export type BusinessRow = typeof businesses.$inferSelect;
export type NewBusinessRow = typeof businesses.$inferInsert;

/**
 * Business ↔ category mapping (B2.4). Composite PK (business_id, category_id);
 * both FKs cascade on business delete. The partial unique index
 * `business_categories_one_primary` enforces "at most one primary category per
 * business" (the service guarantees exactly one primary on insert).
 */
export const businessCategories = pgTable(
  'business_categories',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.categoryId], name: 'business_categories_pk' }),
    uniqueIndex('business_categories_one_primary')
      .on(table.businessId)
      .where(sql`${table.isPrimary}`),
    index('business_categories_category_idx').on(table.categoryId),
  ],
);

export type BusinessCategoryRow = typeof businessCategories.$inferSelect;

/**
 * Business ↔ amenity mapping (B2.4). Composite PK; both FKs cascade on business
 * delete. Powers the amenity-usage delete guard (AmenityUsageCounter) and the
 * business detail's amenities list.
 */
export const businessAmenities = pgTable(
  'business_amenities',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    amenityId: uuid('amenity_id')
      .notNull()
      .references(() => amenities.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.amenityId], name: 'business_amenities_pk' }),
    index('business_amenities_amenity_idx').on(table.amenityId),
  ],
);

export type BusinessAmenityRow = typeof businessAmenities.$inferSelect;
