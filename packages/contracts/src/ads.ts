import { z } from 'zod';
import { uuidSchema } from './primitives.js';
import { pageMetaSchema } from './pagination.js';
import { PAYMENT_STATUSES } from './payment.js';

/**
 * Advertising contracts (B8.3/B8.4). An ad campaign is a paid placement that
 * boosts a business in search results / home slots. Money is in Tomans.
 *
 * The campaign lifecycle:
 *   draft → pending_payment → active → paused → ended → archived
 *
 * Budget + pacing: the owner sets a total budget (Tomans) + a daily cap. The
 * pacing service debits the budget by the CPC (cost-per-click) on each click
 * and the CPM-equivalent on each impression; when the budget is exhausted the
 * campaign auto-pauses. Impressions/clicks are counted atomically (an UPDATE
 * with a WHERE budget_remaining >= cost guard) so a race never over-spends.
 *
 * The «تبلیغ» (Sponsored) label: every ad slot in the UI carries the label;
 * the API marks sponsored hits via `isSponsored: true` on the search hit (a
 * sibling of the existing `isFeatured`). Transparency, not stealth.
 */

/** The ad placement (where the campaign shows). */
export const AD_PLACEMENTS = ['search_top', 'home_slot', 'category_top'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/** The campaign lifecycle. */
export const CAMPAIGN_STATUSES = [
  'draft', // created, not yet paid for
  'pending_payment', // payment initiated, awaiting verify
  'active', // paid + within schedule + budget remaining
  'paused', // owner-paused or budget-exhausted
  'ended', // schedule ended
  'archived', // soft-deleted by the owner
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** The campaign create body. */
export const createCampaignBodySchema = z
  .object({
    businessId: uuidSchema,
    name: z.string().min(1).max(120),
    placements: z.array(z.enum(AD_PLACEMENTS)).min(1).max(3),
    /** Total budget in Tomans. */
    budgetTotal: z.number().int().min(10_000).max(1_000_000_000),
    /** Daily spend cap in Tomans. */
    dailyCap: z.number().int().min(1_000).max(100_000_000),
    /** The CPC the owner bids (cost-per-click, Tomans). */
    cpc: z.number().int().min(100).max(1_000_000),
    /** Schedule (business-local YYYY-MM-DD, inclusive). */
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** The ad headline shown on the card (optional). */
    headline: z.string().max(120).optional(),
  })
  .strict();
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

/** The campaign resource. */
export const campaignSchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    name: z.string(),
    placements: z.array(z.enum(AD_PLACEMENTS)),
    budgetTotal: z.number().int(),
    budgetRemaining: z.number().int(),
    dailyCap: z.number().int(),
    cpc: z.number().int(),
    startsOn: z.string(),
    endsOn: z.string(),
    headline: z.string().nullable(),
    status: z.enum(CAMPAIGN_STATUSES),
    paymentId: uuidSchema.nullable(),
    paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
    impressions: z.number().int().min(0),
    clicks: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Campaign = z.infer<typeof campaignSchema>;

/** GET /ads/businesses/:id/campaigns — the owner's campaigns. */
export const campaignsResultSchema = z
  .object({
    items: z.array(campaignSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type CampaignsResult = z.infer<typeof campaignsResultSchema>;

/** The body to update a campaign's status (pause / resume / end / archive). */
export const updateCampaignStatusBodySchema = z
  .object({
    status: z.enum(['paused', 'active', 'ended', 'archived']),
  })
  .strict();
export type UpdateCampaignStatusBody = z.infer<typeof updateCampaignStatusBodySchema>;

/** The stats for one campaign (a snapshot of spend + delivery). */
export const campaignStatsSchema = z
  .object({
    campaignId: uuidSchema,
    impressions: z.number().int().min(0),
    clicks: z.number().int().min(0),
    /** The CTR (click-through rate, 0..1). */
    ctr: z.number().min(0).max(1),
    spent: z.number().int().min(0),
    budgetRemaining: z.number().int().min(0),
    /** The days the campaign has run (inclusive of today). */
    daysRun: z.number().int().min(0),
    /** The remaining scheduled days (inclusive of today). */
    daysRemaining: z.number().int().min(0),
  })
  .strict();
export type CampaignStats = z.infer<typeof campaignStatsSchema>;

/** The daily breakdown row (one per campaign-day). */
export const campaignDailyRowSchema = z
  .object({
    date: z.string(),
    impressions: z.number().int().min(0),
    clicks: z.number().int().min(0),
    spent: z.number().int().min(0),
  })
  .strict();
export type CampaignDailyRow = z.infer<typeof campaignDailyRowSchema>;

/** GET /ads/campaigns/:id/stats — the campaign's delivery stats. */
export const campaignStatsResultSchema = z
  .object({
    stats: campaignStatsSchema,
    daily: z.array(campaignDailyRowSchema),
  })
  .strict();
export type CampaignStatsResult = z.infer<typeof campaignStatsResultSchema>;
