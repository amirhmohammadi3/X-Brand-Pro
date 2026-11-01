import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Theme packs (B1.13). The three builtin packs are seeded insert-if-absent
 * from `packages/contracts/src/theme/packs.ts` (the single source of token
 * values, per docs/DESIGN.md section 1); admins may edit tokens and reset
 * to the shipped values. `names` is a localized map, `tokens` is the full
 * themeTokensSchema payload (light/dark colors, radius, shadows, layout).
 */
export const themePacks = pgTable('theme_packs', {
  id: text('id').primaryKey(),
  names: jsonb('names').notNull().$type<Record<string, string>>(),
  tokens: jsonb('tokens').notNull(),
  version: integer('version').notNull().default(1),
  isBuiltin: boolean('is_builtin').notNull().default(true),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ThemePackRow = typeof themePacks.$inferSelect;
export type NewThemePackRow = typeof themePacks.$inferInsert;
