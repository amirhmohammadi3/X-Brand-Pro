import { z } from 'zod';
import { pageQuerySchema, pageMetaSchema } from './pagination.js';
import { uuidSchema } from './primitives.js';
import { reviewSchema } from './reviews.js';

/**
 * Abuse reports + the moderation queue (B4.4). Any authenticated user may
 * report a review or a reply for the `reviews.manage` moderators, who
 * triage the queue oldest-pending-first. ONE report per reporter per
 * target (`content_reports_one_per_reporter` unique index) — the ABUSE
 * signal is report VOLUME across distinct users, so a single account can
 * never pump it; a duplicate is a 409, not a second row.
 *
 * Targets are POLYMORPHIC (`targetType` + `targetId`): a report on content
 * that was since hard-deleted stays standing (the trail of WHY content
 * vanished survives the content), and the moderator dismisses orphaned
 * reports. Resolution states: `reviewed` (seen, no violation),
 * `dismissed` (no action needed) and `actioned` (violation handled —
 * usually the target was taken down through the B4.1/B4.3 delete
 * endpoints).
 */

export const REPORT_TARGETS = ['review', 'reply'] as const;
export const reportTargetSchema = z.enum(REPORT_TARGETS);
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_CATEGORIES = ['spam', 'offensive', 'false_info', 'other'] as const;
export const reportCategorySchema = z.enum(REPORT_CATEGORIES);
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_STATUSES = ['pending', 'reviewed', 'dismissed', 'actioned'] as const;
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_DETAILS_MIN = 2;
export const REPORT_DETAILS_MAX = 1000;

/** One report as served by the moderation queue. */
export const reportSchema = z.object({
  id: uuidSchema,
  targetType: reportTargetSchema,
  targetId: uuidSchema,
  reporterUserId: uuidSchema,
  /** The reporter's username — queue rows show WHO reported, moderated by the same RBAC as the queue itself. */
  reporterUsername: z.string().min(3),
  category: reportCategorySchema,
  details: z.string().min(REPORT_DETAILS_MIN).max(REPORT_DETAILS_MAX).nullable(),
  status: reportStatusSchema,
  reviewedBy: uuidSchema.nullable(),
  resolutionNote: z.string().min(REPORT_DETAILS_MIN).max(REPORT_DETAILS_MAX).nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Report = z.infer<typeof reportSchema>;

/** POST /api/v1/reports body. `details` is required when category is 'other'. */
export const createReportBodySchema = z
  .object({
    targetType: reportTargetSchema,
    targetId: uuidSchema,
    category: reportCategorySchema,
    details: z.string().min(REPORT_DETAILS_MIN).max(REPORT_DETAILS_MAX).optional(),
  })
  .strict()
  .refine((v) => v.category !== 'other' || v.details !== undefined, {
    message: 'details are required when category is other',
  });
export type CreateReportBody = z.infer<typeof createReportBodySchema>;

/** 201 response — the created report (status `pending`). */
export const createReportResultSchema = z.object({ report: reportSchema });
export type CreateReportResult = z.infer<typeof createReportResultSchema>;

/** GET /api/v1/moderation/reports query (the queue). */
export const reportQueueQuerySchema = pageQuerySchema.extend({
  status: reportStatusSchema.optional(),
});
export type ReportQueueQuery = z.infer<typeof reportQueueQuerySchema>;

export const reportListResultSchema = z.object({
  items: z.array(reportSchema),
  meta: pageMetaSchema,
});
export type ReportListResult = z.infer<typeof reportListResultSchema>;

/**
 * PATCH /api/v1/moderation/reports/:id body — the moderator's resolution.
 * `pending` is NOT settable here (a decision leaves the queue; only a new
 * report is pending). `reviewed`/`dismissed` mark no violation; `actioned`
 * records that the violation WAS handled (the takedown itself rides the
 * B4.1/B4.3 delete endpoints).
 */
export const resolveReportBodySchema = z
  .object({
    status: z.enum(['reviewed', 'dismissed', 'actioned']),
    resolutionNote: z.string().min(REPORT_DETAILS_MIN).max(REPORT_DETAILS_MAX).optional(),
  })
  .strict();
export type ResolveReportBody = z.infer<typeof resolveReportBodySchema>;

export const resolveReportResultSchema = z.object({ report: reportSchema });
export type ResolveReportResult = z.infer<typeof resolveReportResultSchema>;

/**
 * Review moderation (B4.4) — the flip B4.1 pre-provisioned the
 * `pending`/`rejected` statuses for. The queue is the pending reviews,
 * oldest first (`reviews_status_created_idx`). Only `reviews.manage` may
 * read the queue or flip a status; the AUTHOR cannot (an author unhappy
 * with their own review deletes it), and approval/rejection re-enqueues the
 * rating aggregate (only APPROVED reviews count).
 */
export const reviewQueueQuerySchema = pageQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

export const moderateReviewStatusBodySchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    /** Moderator note — stored on the review row (audit trail). */
    note: z.string().min(REPORT_DETAILS_MIN).max(REPORT_DETAILS_MAX).optional(),
  })
  .strict();
export type ModerateReviewStatusBody = z.infer<typeof moderateReviewStatusBodySchema>;

/** The flip response: the updated review (public shape) + the moderation-only note. */
export const moderateReviewStatusResultSchema = z.object({
  review: reviewSchema,
  moderatorNote: z.string().min(REPORT_DETAILS_MIN).max(REPORT_DETAILS_MAX).nullable(),
});
export type ModerateReviewStatusResult = z.infer<typeof moderateReviewStatusResultSchema>;

/** B4.4 rate limits (single source of truth for the controller + SECURITY.md). */
export const MODERATION_REPORT_LIMIT_PER_HOUR = 10;
export const MODERATION_READ_LIMIT_PER_MIN = 60;
export const MODERATION_DECIDE_LIMIT_PER_MIN = 30;
