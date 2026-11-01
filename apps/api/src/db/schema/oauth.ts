import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Linked external identities (B1.8). One row per (provider, provider user).
 * `provider_user_id` is Google's stable `sub` claim — never the email, which
 * can change. Login resolves the row by (provider, sub); email is stored for
 * display/admin use only.
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'google' (B1.8); more providers later
    providerUserId: text('provider_user_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('oauth_accounts_provider_uid_key').on(table.provider, table.providerUserId),
    index('oauth_accounts_user_id_idx').on(table.userId),
  ],
);

export type OauthAccountRow = typeof oauthAccounts.$inferSelect;
export type NewOauthAccountRow = typeof oauthAccounts.$inferInsert;
