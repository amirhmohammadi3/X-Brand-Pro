import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Languages (B1.12). `fa` is the seed default and is protected server-side
 * (never deactivated or deleted). The partial unique index guarantees at
 * most ONE row with is_default = true; the default switch happens inside a
 * single transaction (unset old → set new).
 */
export const languages = pgTable(
  'languages',
  {
    code: text('code').primaryKey(),
    nameNative: text('name_native').notNull(),
    nameEn: text('name_en').notNull(),
    dir: text('dir').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('languages_dir_check', sql`${t.dir} in ('rtl', 'ltr')`),
    uniqueIndex('languages_single_default_idx')
      .on(t.isDefault)
      .where(sql`is_default`),
  ],
);

/**
 * Flat dot-key translation strings. Primary key (locale, key); deleting a
 * language cascades its translations. `updated_by` is the admin who last
 * edited the row (null for seeder-written rows). Values never contain HTML
 * (enforced at the API boundary, B1.12).
 */
export const translations = pgTable(
  'translations',
  {
    locale: text('locale')
      .notNull()
      .references(() => languages.code, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.locale, t.key] }),
    index('translations_locale_updated_idx').on(t.locale, t.updatedAt),
  ],
);

export type LanguageRow = typeof languages.$inferSelect;
export type NewLanguageRow = typeof languages.$inferInsert;
export type TranslationRow = typeof translations.$inferSelect;
export type NewTranslationRow = typeof translations.$inferInsert;
