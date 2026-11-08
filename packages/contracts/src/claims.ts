import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Business ownership claims (B2.9). A user claims an UNCLAIMED business by
 * submitting evidence (free text, optionally with an uploaded document —
 * B1.9's POST /media/upload with kind `claim_document`, PDF or image). An
 * admin (`businesses.manage`) reviews the pending claim: approving assigns
 * the claimant as the business owner (businesses.owner_id + is_claimed) in
 * the same transaction; rejecting records a note. The claimant may cancel
 * their own pending claim.
 *
 * One PENDING claim per business at a time (partial unique index) — an admin
 * always reviews exactly one live claim per business, and a rejected claim
 * does not block a better-evidenced retry.
 */

export const BUSINESS_CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const businessClaimStatusSchema = z.enum(BUSINESS_CLAIM_STATUSES);
export type BusinessClaimStatus = (typeof BUSINESS_CLAIM_STATUSES)[number];

export const EVIDENCE_MIN = 20;
export const EVIDENCE_MAX = 2000;
export const ADMIN_NOTE_MAX = 500;

/** One claim as served by the claim endpoints. */
export const businessClaimSchema = z.object({
  id: uuidSchema,
  businessId: uuidSchema,
  claimantUserId: uuidSchema,
  status: businessClaimStatusSchema,
  evidence: z.string().min(EVIDENCE_MIN).max(EVIDENCE_MAX),
  /** Public URL of the uploaded evidence document, when one was attached. */
  documentUrl: z.string().min(1).nullable(),
  reviewedBy: uuidSchema.nullable(),
  adminNote: z.string().max(ADMIN_NOTE_MAX).nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type BusinessClaim = z.infer<typeof businessClaimSchema>;

/** Create body — evidence is free text; the document rides /media/upload. */
export const createBusinessClaimBodySchema = z
  .object({
    evidence: z.string().min(EVIDENCE_MIN).max(EVIDENCE_MAX),
    /** Media id from POST /media/upload (kind `claim_document`), owned by the caller. */
    documentMediaId: uuidSchema.optional(),
  })
  .strict();
export type CreateBusinessClaimBody = z.infer<typeof createBusinessClaimBodySchema>;

/**
 * Review body — `adminNote` is REQUIRED when rejecting (the claimant must
 * learn why) and forbidden when approving (an approval needs no note) —
 * schema-enforced, mirroring the business transition refine.
 */
export const reviewBusinessClaimBodySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    adminNote: z.string().min(1).max(ADMIN_NOTE_MAX).optional(),
  })
  .strict()
  .refine((b) => (b.decision === 'reject') === !!b.adminNote, {
    message: 'adminNote is required when rejecting and forbidden when approving',
    path: ['adminNote'],
  });
export type ReviewBusinessClaimBody = z.infer<typeof reviewBusinessClaimBodySchema>;
