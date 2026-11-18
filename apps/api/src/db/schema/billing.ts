import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { users } from './users.js';

/**
 * Phase 8 — payment, subscription, advertising domain (B8.1–B8.6).
 *
 * Five tables + four enums:
 *  - `plans` — the admin-managed plan catalog (seeded with free/starter/pro).
 *  - `subscriptions` — one active per business (the plan they're on).
 *  - `invoices` — one per billing period, linked to the payment that settled it.
 *  - `payments` — the gateway payment intents (idempotent on idempotency_key).
 *  - `ad_campaigns` — the paid-boost campaigns (budget + pacing + stats).
 *
 * Money is integer Tomans (IRT) throughout — the smallest practical unit for
 * a directory product; rial would be 10× noise. The providers bill in Tomans.
 */

/** The gateway providers (B8.1). */
export const paymentProviderEnum = pgEnum('payment_provider', ['fake', 'zarinpal_sandbox']);

/** The payment lifecycle (B8.1). */
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'gatewayed',
  'verified',
  'failed',
  'cancelled',
]);

/** What a payment is FOR (the invoice/subscription/campaign linkage). */
export const paymentPurposeEnum = pgEnum('payment_purpose', ['subscription', 'ads', 'topup']);

/** The plan tier (B8.2). */
export const planTierEnum = pgEnum('plan_tier', ['free', 'starter', 'pro', 'enterprise']);

/** The billing interval (B8.2). */
export const billingIntervalEnum = pgEnum('billing_interval', ['monthly', 'yearly']);

/** The subscription state (B8.2). */
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'cancelled',
  'expired',
]);

/** The ad placement (B8.3). */
export const adPlacementEnum = pgEnum('ad_placement', [
  'search_top',
  'home_slot',
  'category_top',
]);

/** The campaign lifecycle (B8.3). */
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'pending_payment',
  'active',
  'paused',
  'ended',
  'archived',
]);

/**
 * `plans` (B8.2) — the admin-managed plan catalog. Seeded with free/starter/
 * pro; the admin can deactivate (hide) a tier without deleting it. The
 * `limits` JSON column carries the feature caps the API checks at the call
 * site. `name_key` resolves to the i18n key `billing.plan.<tier>.name`.
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tier: planTierEnum('tier').notNull(),
    nameKey: varchar('name_key', { length: 80 }).notNull(),
    priceMonthly: integer('price_monthly').notNull().default(0),
    priceYearly: integer('price_yearly').notNull().default(0),
    /** JSON object matching PlanLimits in the contract. */
    limits: varchar('limits', { length: 1000 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plans_tier_active_unq')
      .on(t.tier)
      .where(sql`is_active = true`),
    index('plans_sort_idx').on(t.sortOrder),
    check('plans_price_monthly_nonneg', sql`price_monthly >= 0`),
    check('plans_price_yearly_nonneg', sql`price_yearly >= 0`),
  ],
);

/**
 * `subscriptions` (B8.2) — one active subscription per business. The unique
 * partial index on `(business_id) WHERE status IN ('active','past_due')`
 * guarantees a business has at most one active subscription; a cancelled/
 * expired row stays for history but a new active row can take its place.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').notNull().references(() => plans.id),
    planTier: planTierEnum('plan_tier').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    interval: billingIntervalEnum('interval').notNull().default('monthly'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    autoRenew: boolean('auto_renew').notNull().default(true),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscriptions_business_active_unq')
      .on(t.businessId)
      .where(sql`status IN ('active', 'past_due')`),
    index('subscriptions_business_idx').on(t.businessId),
    index('subscriptions_period_end_idx').on(t.currentPeriodEnd),
    check('subscriptions_period_order', sql`current_period_end > current_period_start`),
  ],
);

/**
 * `payments` (B8.1) — the gateway payment intents. Idempotent on
 * `(idempotency_key)` — a second request with the same key returns the
 * in-flight payment (so a retry never charges twice). The `authority` is the
 * gateway's tracking code; `reference_id` is set on verify.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('IRT'),
    purpose: paymentPurposeEnum('purpose').notNull(),
    purposeId: uuid('purpose_id').notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    provider: paymentProviderEnum('provider').notNull().default('fake'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    authority: varchar('authority', { length: 200 }),
    referenceId: varchar('reference_id', { length: 200 }),
    gatewayUrl: varchar('gateway_url', { length: 500 }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_idempotency_key_unq').on(t.idempotencyKey),
    index('payments_user_idx').on(t.userId),
    index('payments_business_idx').on(t.businessId),
    index('payments_purpose_idx').on(t.purpose, t.purposeId),
    index('payments_status_idx').on(t.status),
    check('payments_amount_pos', sql`amount > 0`),
  ],
);

/**
 * `invoices` (B8.2) — one per billing period, linked to the payment that
 * settled it. The `number` is a human-readable invoice id (INV-YYYY-NNNN).
 * A `payment_status` snapshot denormalizes the payment state so the list
 * query doesn't have to join (the read is hot, the write is rare).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    planId: uuid('plan_id').notNull().references(() => plans.id),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('IRT'),
    interval: billingIntervalEnum('interval').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    paymentStatus: paymentStatusEnum('payment_status'),
    purpose: paymentPurposeEnum('purpose').notNull(),
    number: varchar('number', { length: 40 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_business_idx').on(t.businessId),
    index('invoices_period_idx').on(t.periodEnd),
    uniqueIndex('invoices_number_unq').on(t.number),
    check('invoices_amount_nonneg', sql`amount >= 0`),
    check('invoices_period_order', sql`period_end > period_start`),
  ],
);

/**
 * `ad_campaigns` (B8.3) — the paid-boost campaigns. Budget + pacing: the
 * `budget_remaining` is debited atomically on each impression/click (an
 * UPDATE with a `WHERE budget_remaining >= cost` guard) so a race never
 * over-spends. The `impressions` / `clicks` counters are likewise atomic.
 * The `placements` array is stored as a comma-separated enum list (a small
 * fixed set; a join table is overkill for ≤3 placements per campaign).
 */
export const adCampaigns = pgTable(
  'ad_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    /** Comma-separated ad_placement values (≤3). */
    placements: varchar('placements', { length: 60 }).notNull(),
    budgetTotal: integer('budget_total').notNull(),
    budgetRemaining: integer('budget_remaining').notNull(),
    dailyCap: integer('daily_cap').notNull(),
    cpc: integer('cpc').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    headline: varchar('headline', { length: 120 }),
    status: campaignStatusEnum('status').notNull().default('draft'),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    paymentStatus: paymentStatusEnum('payment_status'),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ad_campaigns_business_idx').on(t.businessId),
    index('ad_campaigns_status_idx').on(t.status),
    index('ad_campaigns_schedule_idx').on(t.startsOn, t.endsOn),
    check('ad_campaigns_budget_pos', sql`budget_total > 0`),
    check('ad_campaigns_budget_remaining_nonneg', sql`budget_remaining >= 0`),
    check('ad_campaigns_daily_cap_pos', sql`daily_cap > 0`),
    check('ad_campaigns_cpc_pos', sql`cpc > 0`),
    check('ad_campaigns_schedule_order', sql`ends_on >= starts_on`),
    check('ad_campaigns_counters_nonneg', sql`impressions >= 0 AND clicks >= 0`),
  ],
);

/** Inferred row types (one pair per table — the repository + service import these). */
export type PlanRow = typeof plans.$inferSelect;
export type NewPlanRow = typeof plans.$inferInsert;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoiceRow = typeof invoices.$inferInsert;
export type AdCampaignRow = typeof adCampaigns.$inferSelect;
export type NewAdCampaignRow = typeof adCampaigns.$inferInsert;
