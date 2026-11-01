import {
  index,
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

export const userStatusEnum = pgEnum('user_status', ['active', 'blocked']);

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
    // B1.3: preferred UI locale (localeCodeShape); null = server default (fa).
    locale: text('locale'),
    // B1.3: email/phone stay UNVERIFIED at register; B1.7 flips the stamps.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    // B1.3: temporary ban window (login + guard reject while it is in the future).
    bannedUntil: timestamp('banned_until', { withTimezone: true }),
    // B1.9: avatar media row; null until B1.10 wires the profile avatar flow.
    // FK is declared here, on the users side of the users<->media pair (the
    // media side references users.id); drizzle resolves both lazily.
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => mediaFiles.id, {
      onDelete: 'set null',
    }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (table) => [
    index('users_username_idx').on(table.username),
    index('users_email_idx').on(table.email),
    index('users_phone_idx').on(table.phone),
    index('users_role_idx').on(table.role),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
