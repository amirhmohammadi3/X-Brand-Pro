import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Runtime settings (B1.1) — key/value store for configuration an admin may
 * change without a deploy. Secrets (SMS tokens, SMTP passwords, AI keys,
 * …) are stored ENCRYPTED (AES-256-GCM envelope) in `value`; the plaintext
 * never touches the database. Values that are not secrets stay plain JSON.
 * Every key must be registered in settings.registry.ts before use.
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
    group: text('group').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('settings_group_idx').on(table.group)],
);

export type SettingRow = typeof settings.$inferSelect;
export type NewSettingRow = typeof settings.$inferInsert;
