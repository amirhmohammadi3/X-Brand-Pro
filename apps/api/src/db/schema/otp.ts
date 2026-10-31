import { index, inet, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** What the code is for (B1.4). Drives invalidation scoping and audits. */
export const otpPurposeEnum = pgEnum('otp_purpose', [
  'login',
  'verify_email',
  'verify_phone',
  'reset_password',
  'change_email',
  'change_phone',
]);

export const otpChannelEnum = pgEnum('otp_channel', ['sms', 'email']);

/**
 * One-time codes (B1.4). The PLAIN code is never stored: `code_hash` is the
 * HMAC-SHA256 hex of `<id>:<code>` keyed by OTP_HMAC_SECRET. A new issue for
 * the same target+purpose consumes the previous unconsumed rows.
 */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: otpPurposeEnum('purpose').notNull(),
    channel: otpChannelEnum('channel').notNull(),
    /** Normalized E.164 phone or lowercase email. */
    target: text('target').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('otp_target_purpose_created_idx').on(table.target, table.purpose, table.createdAt.desc()),
    index('otp_expires_at_idx').on(table.expiresAt),
  ],
);

export type OtpCodeRow = typeof otpCodes.$inferSelect;
export type NewOtpCodeRow = typeof otpCodes.$inferInsert;
