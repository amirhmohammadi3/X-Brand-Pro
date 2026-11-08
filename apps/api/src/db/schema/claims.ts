import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { mediaFiles } from './media.js';
import { users } from './users.js';

/**
 * Business ownership claims (B2.9). A user claims an unclaimed business with
 * evidence (text + optional uploaded document); an admin approves (→ the
 * claimant becomes the owner: businesses.owner_id + is_claimed in the same
 * transaction) or rejects (→ a note is stored). `cancelled` is the claimant's
 * own exit.
 *
 * `document_media_id` FK is ON DELETE SET NULL: the media module hard-deletes
 * rows during cleanup; the claim (audit trail) must survive with the document
 * reference nulled. `reviewed_by` is SET NULL too (an admin account removal
 * must not erase the decision).
 *
 * The partial unique index `business_claims_one_pending` guarantees at most
 * one PENDING claim per business — the admin queue always shows at most one
 * live claim per business, and a rejected claim does not block a retry.
 */
export const businessClaimStatusEnum = pgEnum('business_claim_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);

export const businessClaims = pgTable(
  'business_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    claimantUserId: uuid('claimant_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: businessClaimStatusEnum('status').notNull().default('pending'),
    evidence: text('evidence').notNull(),
    documentMediaId: uuid('document_media_id').references(() => mediaFiles.id, {
      onDelete: 'set null',
    }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    adminNote: text('admin_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('business_claims_one_pending')
      .on(table.businessId)
      .where(sql`status = 'pending'`),
    index('business_claims_claimant_idx').on(table.claimantUserId, table.createdAt.desc()),
    index('business_claims_status_created_idx').on(table.status, table.createdAt.desc()),
  ],
);

export type BusinessClaimRow = typeof businessClaims.$inferSelect;
export type NewBusinessClaimRow = typeof businessClaims.$inferInsert;
