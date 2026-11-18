import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  PLAN_TIERS,
  type BillingInterval,
  type Invoice,
  type Plan,
  type PlanLimits,
  type PlanTier,
  type RevenueReport,
  type Subscription,
  type SubscriptionResult,
  type SubscriptionStatus,
  type UpsertSubscriptionBody,
  type PlansResult,
  type InvoicesResult,
  type PaymentStatus,
  type PaymentPurpose,
} from '@app/contracts';
import {
  BILLING_REPOSITORY,
  type BillingRepositoryLike,
  type PlanRow,
  type SubscriptionRow,
  type InvoiceRow,
} from './billing.repository.js';

/** The default free-tier limits (the fallback when a business has no subscription). */
export const FREE_TIER_LIMITS: PlanLimits = {
  galleryPhotos: 8,
  menuItems: 20,
  videos: false,
  ai: false,
  ads: false,
  adCampaigns: 0,
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * BillingService (B8.2) — the plans catalog, the per-business subscription,
 * and the invoice creation. The subscription upsert is the core: it creates
 * OR upgrades an active subscription, computes the period (monthly = 30d,
 * yearly = 365d), and drafts an invoice (settled when the payment verifies).
 *
 * The limits read (`getSubscription`) returns the active subscription OR the
 * free-tier fallback — the API checks these caps at the call site (e.g. «can
 * this business post a video?» → the active plan's `limits.videos`).
 *
 * The settle hook (`onPaymentVerified`) is called by the PaymentService when
 * a payment for a subscription verifies — it links the invoice to the payment
 * + flips the subscription to `active` (a pending_payment subscription stays
 * `pending_payment` until the verify lands).
 */
@Injectable()
export class BillingService {
  constructor(@Inject(BILLING_REPOSITORY) private readonly repo: BillingRepositoryLike) {}

  // --- plans ---
  async listPlans(): Promise<PlansResult> {
    const rows = await this.repo.listActivePlans();
    return {
      items: rows.map(toPlan),
      meta: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 },
    };
  }

  // --- subscription ---
  async getSubscription(businessId: string): Promise<SubscriptionResult> {
    const sub = await this.repo.findActiveSubscription(businessId);
    if (!sub) {
      return { subscription: null, limits: FREE_TIER_LIMITS };
    }
    const plan = await this.repo.findPlanById(sub.planId);
    const limits = plan ? parseLimits(plan.limits) : FREE_TIER_LIMITS;
    return { subscription: toSubscription(sub), limits };
  }

  /**
   * Create OR upgrade the business's subscription. The unique partial index
   * `subscriptions_business_active_unq` guarantees at most one active row —
   * an upgrade cancels the previous + inserts a new active row (the old row
   * stays for history). The invoice is drafted as `pending` (the payment
   * settles it on verify).
   */
  async upsertSubscription(
    businessId: string,
    body: UpsertSubscriptionBody,
  ): Promise<{ subscription: Subscription; invoice: Invoice; payment: { amount: number; purpose: PaymentPurpose; purposeId: string; description: string } }> {
    const plan = await this.repo.findPlanById(body.planId);
    if (!plan || !plan.isActive) {
      throw new BadRequestException({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest', message: 'Plan not found or inactive.' });
    }
    // Cancel any existing active subscription (the unique index demands it).
    const existing = await this.repo.findActiveSubscription(businessId);
    if (existing) {
      await this.repo.updateSubscription(existing.id, { status: 'cancelled', cancelledAt: new Date() });
    }
    const now = new Date();
    const periodEnd = computePeriodEnd(now, body.interval);
    const amount = body.interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const sub = await this.repo.insertSubscription({
      businessId,
      planId: plan.id,
      planTier: plan.tier,
      status: 'pending_payment',
      interval: body.interval,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      autoRenew: body.autoRenew ?? true,
      cancelledAt: null,
    });
    // Draft the invoice (pending until the payment verifies).
    const number = await this.repo.nextInvoiceNumber();
    const invoice = await this.repo.insertInvoice({
      businessId,
      subscriptionId: sub.id,
      planId: plan.id,
      amount,
      currency: 'IRT',
      interval: body.interval,
      periodStart: now,
      periodEnd,
      paymentId: null,
      paymentStatus: 'pending',
      purpose: 'subscription',
      number,
    });
    return {
      subscription: toSubscription(sub),
      invoice: toInvoice(invoice),
      payment: {
        amount,
        purpose: 'subscription' as PaymentPurpose,
        purposeId: invoice.id, // the invoice is the purpose resource
        description: `Plan ${plan.tier} — ${body.interval} (${number})`,
      },
    };
  }

  /** Cancel the business's active subscription (the period runs out, no renew). */
  async cancelSubscription(businessId: string): Promise<Subscription | null> {
    const sub = await this.repo.findActiveSubscription(businessId);
    if (!sub) return null;
    const updated = await this.repo.updateSubscription(sub.id, {
      status: 'cancelled',
      autoRenew: false,
      cancelledAt: new Date(),
    });
    return updated ? toSubscription(updated) : null;
  }

  // --- invoices ---
  async listInvoices(businessId: string, page: number, pageSize: number): Promise<InvoicesResult> {
    const limit = Math.min(pageSize || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { items, total } = await this.repo.listInvoices(businessId, {
      limit,
      offset: (page - 1) * limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      items: items.map(toInvoice),
      meta: { page, pageSize: limit, total, totalPages },
    };
  }

  async getInvoice(invoiceId: string): Promise<Invoice> {
    const row = await this.repo.findInvoiceById(invoiceId);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    return toInvoice(row);
  }

  // --- payment-settle hook (called by PaymentService.onPaymentVerified) ---
  /**
   * Settle the invoice linked to a verified payment. Flips the invoice's
   * paymentStatus to `verified` + activates the subscription (from
   * `pending_payment` to `active`). Idempotent — re-settling a verified
   * invoice is a no-op.
   */
  async onPaymentVerified(paymentId: string, purposeId: string): Promise<void> {
    const invoice = await this.repo.findInvoiceById(purposeId);
    if (!invoice) return; // not a subscription payment (could be ads)
    if (invoice.paymentStatus === 'verified') return; // idempotent
    await this.repo.settleInvoice(invoice.id, paymentId, 'verified');
    if (invoice.subscriptionId) {
      const sub = await this.repo.findSubscriptionById(invoice.subscriptionId);
      if (sub && sub.status === 'pending_payment') {
        await this.repo.updateSubscription(sub.id, { status: 'active' });
      }
    }
  }

  // --- revenue report (B8.6) ---
  /**
   * The admin-facing revenue report over a `YYYY-MM-DD` window (defaults to
   * the last 30 days). Aggregates verified payments by purpose + by plan tier;
   * the by-plan breakdown joins payments↔invoices (an ad campaign payment has
   * no invoice → `null` plan tier).
   */
  async getRevenueReport(query: { from?: string; to?: string }): Promise<RevenueReport> {
    const to = query.to ?? todayIso();
    const from = query.from ?? rangeWindow(30).from;
    const { byPurpose, byPlan, total } = await this.repo.revenueAggregates(from, to);
    const averageTransaction = total.count > 0 ? Math.round(total.amount / total.count) : 0;
    return {
      from,
      to,
      totalRevenue: total.amount,
      totalTransactions: total.count,
      averageTransaction,
      byPurpose: byPurpose.map((r) => ({
        purpose: r.purpose as PaymentPurpose,
        count: r.count,
        amount: r.amount,
      })),
      byPlan: byPlan.map((r) => ({
        planTier: r.planTier as PlanTier | null,
        count: r.count,
        amount: r.amount,
      })),
    };
  }

  // --- expiry job (called by the maintenance dispatcher) ---
  /**
   * Mark subscriptions whose period has ended. Auto-renewing ones stay
   * `active` (a follow-up creates the renewal invoice + payment intent);
   * non-renewing ones flip to `expired`. Returns the count flipped.
   */
  async expirePastDue(): Promise<number> {
    const now = new Date();
    const expiring = await this.repo.findExpiring(now);
    let count = 0;
    for (const sub of expiring) {
      if (sub.autoRenew) {
        // v1: auto-renew is NOT implemented (a follow-up creates the renewal
        // invoice + payment intent). For now, flip to `expired` so the
        // business re-subscribes — the free-tier fallback kicks in.
        await this.repo.updateSubscription(sub.id, { status: 'expired' });
      } else {
        await this.repo.updateSubscription(sub.id, { status: 'expired' });
      }
      count += 1;
    }
    return count;
  }
}

/** Compute the period end: monthly = +30d, yearly = +365d. */
function computePeriodEnd(start: Date, interval: BillingInterval): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (interval === 'yearly' ? 365 : 30));
  return end;
}

/** Parse the limits JSON column (stored as a string for v1 simplicity). */
function parseLimits(raw: string): PlanLimits {
  try {
    const parsed = JSON.parse(raw) as PlanLimits;
    return {
      galleryPhotos: parsed.galleryPhotos ?? FREE_TIER_LIMITS.galleryPhotos,
      menuItems: parsed.menuItems ?? FREE_TIER_LIMITS.menuItems,
      videos: parsed.videos ?? false,
      ai: parsed.ai ?? false,
      ads: parsed.ads ?? false,
      adCampaigns: parsed.adCampaigns ?? 0,
    };
  } catch {
    return FREE_TIER_LIMITS;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The last `days` days inclusive of today (YYYY-MM-DD). */
function rangeWindow(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    tier: row.tier as PlanTier,
    nameKey: row.nameKey,
    priceMonthly: row.priceMonthly,
    priceYearly: row.priceYearly,
    limits: parseLimits(row.limits),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    businessId: row.businessId,
    planId: row.planId,
    planTier: row.planTier as PlanTier,
    status: row.status as SubscriptionStatus,
    interval: row.interval as BillingInterval,
    currentPeriodStart: row.currentPeriodStart.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    autoRenew: row.autoRenew,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
  };
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    businessId: row.businessId,
    subscriptionId: row.subscriptionId,
    planId: row.planId,
    amount: row.amount,
    currency: row.currency as 'IRT',
    interval: row.interval as BillingInterval,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    paymentId: row.paymentId,
    paymentStatus: row.paymentStatus as PaymentStatus | null,
    purpose: row.purpose as PaymentPurpose,
    number: row.number,
    createdAt: row.createdAt.toISOString(),
  };
}

export { PLAN_TIERS };
export type { PlanRow, SubscriptionRow, InvoiceRow };
