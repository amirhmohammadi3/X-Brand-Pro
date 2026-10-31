import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
