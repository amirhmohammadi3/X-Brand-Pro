import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
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
    check('categories_name_has_fa', sql`${table.name} ? 'fa'`),
    check('categories_kind_enum', sql`${table.kind} in ('menu', 'services', 'none')`),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
