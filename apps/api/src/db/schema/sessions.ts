import { index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Server-side sessions (B1.3). One row per issued refresh token. Rotation
 * chains share `family_id`; presenting an already-replaced or revoked token
 * revokes the whole family (reuse detection). `refresh_hash` is the SHA-256
 * hex of the opaque refresh token — the raw token is never stored.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    refreshHash: text('refresh_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    replacedBy: uuid('replaced_by'),
  },
  (table) => [
    index('sessions_user_revoked_idx').on(table.userId, table.revokedAt),
    index('sessions_family_idx').on(table.familyId),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
