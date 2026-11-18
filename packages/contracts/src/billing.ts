import { z } from 'zod';
import { uuidSchema } from './primitives.js';
import { pageMetaSchema } from './pagination.js';
import { PAYMENT_STATUSES, PAYMENT_PURPOSES } from './payment.js';

/**
 * Billing contracts (B8.2). The plans catalog, the per-business subscription,
 * and the invoices. Money is in Iranian Tomans (integer).
 *
 * Feature caps: a plan carries a `limits` object keyed by feature name; the
 * API checks these at the call site (e.g. «can this business post a video?»
 * → check the active plan's `limits.videos`). The default `free` plan ships
 * with caps low enough that upgrades are attractive but the free tier is
 * usable for a real small business.
 */

/** A billing plan tier. */
export const PLAN_TIERS = ['free', 'starter', 'pro', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** A billing interval (monthly is the v1 default; yearly = 10× monthly). */
export const BILLING_INTERVALS = ['monthly', 'yearly'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** The feature-cap shape (what a plan limits). */
export const planLimitsSchema = z
  .object({
    /** Max photos in the gallery (B2.7). */
    galleryPhotos: z.number().int().min(0),
    /** Max menu items (B2.8). */
    menuItems: z.number().int().min(0),
    /** Whether the business can post short videos (B11 — future). */
    videos: z.boolean(),
    /** Whether AI features are enabled (B9 — future). */
    ai: z.boolean(),
    /** Whether the business can run ad campaigns (B8.3). */
    ads: z.boolean(),
    /** Max concurrent active ad campaigns. */
    adCampaigns: z.number().int().min(0),
  })
  .strict();
export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** A billing plan (admin-managed catalog, seeded). */
export const planSchema = z
  .object({
    id: uuidSchema,
    tier: z.enum(PLAN_TIERS),
    /** The display name (localized via the i18n key `billing.plan.<tier>.name`). */
    nameKey: z.string().min(1).max(80),
    /** Monthly price in Tomans (0 for free). */
    priceMonthly: z.number().int().min(0),
    /** Yearly price in Tomans (0 for free; otherwise ~10× monthly). */
    priceYearly: z.number().int().min(0),
    limits: planLimitsSchema,
    /** Whether the plan is purchasable (hidden tiers are admin-only). */
    isActive: z.boolean(),
    /** Sort order in the catalog (lowest first). */
    sortOrder: z.number().int().min(0),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;

/** The list of purchasable plans (GET /billing/plans). */
export const plansResultSchema = z
  .object({
    items: z.array(planSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type PlansResult = z.infer<typeof plansResultSchema>;

/** A business's subscription state. `pending_payment` = created, awaiting the
 *  payment to verify before it goes `active` (the upsert drafts an invoice +
 *  flips to `pending_payment`; the PaymentService.onPaymentVerified hook
 *  flips it to `active` when the verify lands). */
export const SUBSCRIPTION_STATUSES = [
  'pending_payment',
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptionSchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    planId: uuidSchema,
    planTier: z.enum(PLAN_TIERS),
    status: z.enum(SUBSCRIPTION_STATUSES),
    interval: z.enum(BILLING_INTERVALS),
    /** When the current period started. */
    currentPeriodStart: z.string().datetime(),
    /** When the current period ends (renewal / expiry). */
    currentPeriodEnd: z.string().datetime(),
    /** Whether the subscription auto-renews at period end. */
    autoRenew: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    cancelledAt: z.string().datetime().nullable(),
  })
  .strict();
export type Subscription = z.infer<typeof subscriptionSchema>;

/** GET /billing/businesses/:id/subscription — the active subscription. */
export const subscriptionResultSchema = z
  .object({
    subscription: subscriptionSchema.nullable(),
    /** The effective limits (the plan's caps, or the free-tier fallback). */
    limits: planLimitsSchema,
  })
  .strict();
export type SubscriptionResult = z.infer<typeof subscriptionResultSchema>;

/** Subscribe / change-plan body (POST /billing/businesses/:id/subscription). */
export const upsertSubscriptionBodySchema = z
  .object({
    planId: uuidSchema,
    interval: z.enum(BILLING_INTERVALS),
    autoRenew: z.boolean().optional(),
  })
  .strict();
export type UpsertSubscriptionBody = z.infer<typeof upsertSubscriptionBodySchema>;

/** An invoice — one per billing period, linked to the payment that settled it. */
export const invoiceSchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    subscriptionId: uuidSchema.nullable(),
    planId: uuidSchema,
    amount: z.number().int().min(0),
    currency: z.literal('IRT'),
    interval: z.enum(BILLING_INTERVALS),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    paymentId: uuidSchema.nullable(),
    paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
    purpose: z.enum(PAYMENT_PURPOSES),
    /** A human-readable invoice number (e.g. INV-2026-0001). */
    number: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Invoice = z.infer<typeof invoiceSchema>;

/** GET /billing/businesses/:id/invoices — the business's invoice history. */
export const invoicesResultSchema = z
  .object({
    items: z.array(invoiceSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type InvoicesResult = z.infer<typeof invoicesResultSchema>;
