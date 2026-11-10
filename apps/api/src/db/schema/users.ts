import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { mediaFiles } from './media.js';

/** Database roles (guest is implicit for unauthenticated requests). */
export const userRoleEnum = pgEnum('user_role', [
  'user',
  'owner',
  'moderator',
  'admin',
  'super_admin',
]);

export const userStatusEnum = pgEnum('user_status', ['active', 'blocked', 'deleted']);

/**
 * Users (B1.2). Password hash is nullable because an account may exist via
 * OTP/Google before a password is ever set (B1.3/B1.7/B1.8 fill it).
 * username/email/phone are unique where present; email/phone are nullable
 * until the respective login method connects them.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    email: text('email'),
    phone: text('phone'), // E.164 +989… (AGENTS.md section 8)
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('active'),
    displayName: text('display_name'),
    // B1.10: short public profile text (<= 300 chars, nullable = unset).
    bio: text('bio'),
    // B1.3: preferred UI locale (localeCodeShape); null = server default (fa).
    locale: text('locale'),
    // B1.3: email/phone stay UNVERIFIED at register; B1.7 flips the stamps.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    // B1.3: temporary ban window (login + guard reject while it is in the future).
    bannedUntil: timestamp('banned_until', { withTimezone: true }),
    // B1.14: admin-set ban reason (3-500 chars) stored alongside the window.
    bannedReason: text('banned_reason'),
    // B1.9: avatar media row; null until B1.10 wires the profile avatar flow.
    // FK is declared here, on the users side of the users<->media pair (the
    // media side references users.id); drizzle resolves both lazily.
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => mediaFiles.id, {
      onDelete: 'set null',
    }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    // B1.10: 30-day cooldown anchor between username changes (null = never).
    usernameChangedAt: timestamp('username_changed_at', { withTimezone: true }),
    // B1.10: soft delete stamp; deleted rows are anonymized and excluded
    // from every login/lookup path.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * B4.7 — the denormalised reputation score (integer ≥ 0). Derived FROM
     * SOURCE by the `reviews` queue's `recompute-reputation` job (full
     * recompute over approved reviews / verified proofs / helpful votes
     * received — the businesses.avg_rating pattern), never incremented
     * inline: a takedown or vote switch cannot drift it.
     */
    reputationPoints: integer('reputation_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (table) => [
    index('users_username_idx').on(table.username),
    index('users_email_idx').on(table.email),
    index('users_phone_idx').on(table.phone),
    index('users_role_idx').on(table.role),
    // B1.14: trigram search over lowercased identity columns (admin q search).
    index('users_username_trgm_idx').using('gin', sql`lower(${table.username}) gin_trgm_ops`),
    index('users_email_trgm_idx').using('gin', sql`lower(${table.email}) gin_trgm_ops`),
    index('users_display_name_trgm_idx').using(
      'gin',
      sql`lower(${table.displayName}) gin_trgm_ops`,
    ),
    // Admin list filters/sorts (B1.14).
    index('users_status_idx').on(table.status),
    index('users_created_at_idx').on(table.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
