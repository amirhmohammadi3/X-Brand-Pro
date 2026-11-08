import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { and, eq, sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { mediaFiles } from './media.js';

/**
 * Menu / services of a business (B2.8). Two levels: named sections
 * ("غذاهای اصلی", "خدمات ما"…) each holding items with an optional price
 * (rials — Iran has no subunit in practice; see DECISIONS B2.8) and an
 * optional photo (a `media_files` row of kind `menu_photo`).
 *
 * Sections and items are ordered manually (`sort_order` = the array index of
 * the last full-menu replace). `business_menu_items.business_id` is
 * DENORMALISED from the section so the replace flow can wipe + recreate the
 * whole menu of one business in scoped queries without joining through
 * sections (and so "does this item belong to this business" is a single
 * indexed check).
 *
 * `photo_media_id` FK is ON DELETE SET NULL on purpose: the media module
 * hard-deletes rows (orphan sweep / post-soft-delete cleanup); the menu item
 * must survive with its photo simply becoming null. Media soft-deletes keep
 * the row, so a soft-deleted photo still resolves its URLs until cleanup —
 * the replace flow soft-deletes removed photos itself.
 */
export const businessMenuSections = pgTable(
  'business_menu_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('business_menu_sections_biz_sort_idx').on(table.businessId, table.sortOrder)],
);

export type BusinessMenuSectionRow = typeof businessMenuSections.$inferSelect;

export const businessMenuItems = pgTable(
  'business_menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => businessMenuSections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    price: bigint('price', { mode: 'number' }),
    photoMediaId: uuid('photo_media_id').references(() => mediaFiles.id, {
      onDelete: 'set null',
    }),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('business_menu_items_section_sort_idx').on(table.sectionId, table.sortOrder),
    index('business_menu_items_biz_idx').on(table.businessId),
    check('business_menu_items_price_nonneg', sql`${table.price} >= 0`),
  ],
);

export type BusinessMenuItemRow = typeof businessMenuItems.$inferSelect;

/** Scope helper kept next to the schema for the repository's delete/update calls. */
export const menuSectionOfBusiness = (businessId: string, sectionId: string) =>
  and(eq(businessMenuSections.businessId, businessId), eq(businessMenuSections.id, sectionId));

export const menuItemOfBusiness = (businessId: string, itemId: string) =>
  and(eq(businessMenuItems.businessId, businessId), eq(businessMenuItems.id, itemId));
