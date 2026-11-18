import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  invoices,
  payments,
  plans,
  subscriptions,
  type InvoiceRow,
  type NewInvoiceRow,
  type NewSubscriptionRow,
  type PlanRow,
  type SubscriptionRow,
} from '../../db/schema/billing.js';
import type {
  BillingInterval,
  PaymentStatus,
  PaymentPurpose,
  PlanTier,
  SubscriptionStatus,
} from '@app/contracts';

/** DI token for the billing repository (tests bind a fake). */
export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');

/**
 * The narrow fake-able surface for the billing domain: plan catalog reads,
 * subscription upsert/read, and invoice creation/listing. Kept small so the
 * in-memory fake in tests stays trivial.
 */
export interface BillingRepositoryLike {
  // --- plans ---
  listActivePlans(): Promise<PlanRow[]>;
  findPlanById(id: string): Promise<PlanRow | null>;
  findPlanByTier(tier: PlanTier): Promise<PlanRow | null>;

  // --- subscriptions ---
  findActiveSubscription(businessId: string): Promise<SubscriptionRow | null>;
  findSubscriptionById(id: string): Promise<SubscriptionRow | null>;
  insertSubscription(row: NewSubscriptionRow): Promise<SubscriptionRow>;
  updateSubscription(
    id: string,
    patch: Partial<{
      planId: string;
      planTier: PlanTier;
      status: SubscriptionStatus;
      interval: BillingInterval;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      autoRenew: boolean;
      cancelledAt: Date | null;
    }>,
  ): Promise<SubscriptionRow | null>;
  /** Find subscriptions whose period has ended (for the expiry job). */
  findExpiring(now: Date): Promise<SubscriptionRow[]>;

  // --- invoices ---
  insertInvoice(row: NewInvoiceRow): Promise<InvoiceRow>;
  findInvoiceById(id: string): Promise<InvoiceRow | null>;
  findInvoiceByNumber(number: string): Promise<InvoiceRow | null>;
  listInvoices(
    businessId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: InvoiceRow[]; total: number }>;
  /** The next invoice number (INV-YYYY-NNNN) for the current year. */
  nextInvoiceNumber(): Promise<string>;
  /** Link an invoice to a payment (settles it). */
  settleInvoice(invoiceId: string, paymentId: string, paymentStatus: PaymentStatus): Promise<InvoiceRow | null>;

  // --- revenue report (B8.6) ---
  /**
   * Aggregate the verified payments in [from, to] (YYYY-MM-DD, inclusive) by
   * purpose + by plan tier (the plan tier is read from the invoice's plan).
   * Returns the raw rows; the service shapes the report.
   */
  revenueAggregates(
    from: string,
    to: string,
  ): Promise<{
    byPurpose: Array<{ purpose: string; count: number; amount: number }>;
    byPlan: Array<{ planTier: string | null; count: number; amount: number }>;
    total: { count: number; amount: number };
  }>;
}

@Injectable()
export class BillingRepository implements BillingRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  // --- plans ---
  async listActivePlans(): Promise<PlanRow[]> {
    return this.client.db
      .select()
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(plans.sortOrder);
  }

  async findPlanById(id: string): Promise<PlanRow | null> {
    const rows = await this.client.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findPlanByTier(tier: PlanTier): Promise<PlanRow | null> {
    const rows = await this.client.db
      .select()
      .from(plans)
      .where(and(eq(plans.tier, tier), eq(plans.isActive, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  // --- subscriptions ---
  async findActiveSubscription(businessId: string): Promise<SubscriptionRow | null> {
    const rows = await this.client.db
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.businessId, businessId), sql`${subscriptions.status} IN ('active', 'past_due')`),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSubscriptionById(id: string): Promise<SubscriptionRow | null> {
    const rows = await this.client.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertSubscription(row: NewSubscriptionRow): Promise<SubscriptionRow> {
    const inserted = await this.client.db.insert(subscriptions).values(row).returning();
    return inserted[0]!;
  }

  async updateSubscription(
    id: string,
    patch: Partial<{
      planId: string;
      planTier: PlanTier;
      status: SubscriptionStatus;
      interval: BillingInterval;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      autoRenew: boolean;
      cancelledAt: Date | null;
    }>,
  ): Promise<SubscriptionRow | null> {
    const updated = await this.client.db
      .update(subscriptions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
      .returning();
    return updated[0] ?? null;
  }

  async findExpiring(now: Date): Promise<SubscriptionRow[]> {
    return this.client.db
      .select()
      .from(subscriptions)
      .where(
        and(
          sql`${subscriptions.status} IN ('active', 'past_due')`,
          lte(subscriptions.currentPeriodEnd, now),
        ),
      );
  }

  // --- invoices ---
  async insertInvoice(row: NewInvoiceRow): Promise<InvoiceRow> {
    const inserted = await this.client.db.insert(invoices).values(row).returning();
    return inserted[0]!;
  }

  async findInvoiceById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.client.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findInvoiceByNumber(number: string): Promise<InvoiceRow | null> {
    const rows = await this.client.db
      .select()
      .from(invoices)
      .where(eq(invoices.number, number))
      .limit(1);
    return rows[0] ?? null;
  }

  async listInvoices(
    businessId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: InvoiceRow[]; total: number }> {
    const items = await this.client.db
      .select()
      .from(invoices)
      .where(eq(invoices.businessId, businessId))
      .orderBy(desc(invoices.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const countRows = await this.client.db
      .select({ count: invoices.id })
      .from(invoices)
      .where(eq(invoices.businessId, businessId));
    return { items, total: countRows.length };
  }

  async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    // Count invoices this year to derive the sequence (INV-YYYY-NNNN).
    const rows = await this.client.db
      .select({ number: invoices.number })
      .from(invoices)
      .where(sql`number LIKE 'INV-${year}-%'`);
    const next = rows.length + 1;
    return `INV-${year}-${String(next).padStart(4, '0')}`;
  }

  async settleInvoice(
    invoiceId: string,
    paymentId: string,
    paymentStatus: PaymentStatus,
  ): Promise<InvoiceRow | null> {
    const updated = await this.client.db
      .update(invoices)
      .set({ paymentId, paymentStatus })
      .where(eq(invoices.id, invoiceId))
      .returning();
    return updated[0] ?? null;
  }

  /**
   * Aggregate the verified payments in [from, to] by purpose + by plan tier.
   * Joins payments ↔ invoices (the plan tier lives on the invoice) so an ad
   * campaign payment (no invoice → no plan tier) is counted under `null` tier.
   * The window is inclusive on both ends (YYYY-MM-DD, business-local).
   */
  async revenueAggregates(
    from: string,
    to: string,
  ): Promise<{
    byPurpose: Array<{ purpose: string; count: number; amount: number }>;
    byPlan: Array<{ planTier: string | null; count: number; amount: number }>;
    total: { count: number; amount: number };
  }> {
    const fromTs = new Date(`${from}T00:00:00Z`);
    const toTs = new Date(`${to}T23:59:59Z`);
    // byPurpose — group verified payments by purpose.
    const byPurposeRows = await this.client.db
      .select({
        purpose: payments.purpose,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'verified'),
          gte(payments.verifiedAt, fromTs),
          lte(payments.verifiedAt, toTs),
        ),
      )
      .groupBy(payments.purpose);
    // byPlan — left-join payments to invoices (the plan tier is on the invoice).
    const byPlanRows = await this.client.db
      .select({
        planTier: sql<string | null>`${plans.tier}`,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
      })
      .from(payments)
      .leftJoin(invoices, eq(invoices.paymentId, payments.id))
      .leftJoin(plans, eq(plans.id, invoices.planId))
      .where(
        and(
          eq(payments.status, 'verified'),
          gte(payments.verifiedAt, fromTs),
          lte(payments.verifiedAt, toTs),
        ),
      )
      .groupBy(sql`${plans.tier}`);
    const byPurpose = byPurposeRows.map((r) => ({
      purpose: r.purpose,
      count: Number(r.count),
      amount: Number(r.amount),
    }));
    const byPlan = byPlanRows.map((r) => ({
      planTier: r.planTier,
      count: Number(r.count),
      amount: Number(r.amount),
    }));
    const totalAmount = byPurpose.reduce((s, r) => s + r.amount, 0);
    const totalCount = byPurpose.reduce((s, r) => s + r.count, 0);
    return { byPurpose, byPlan, total: { count: totalCount, amount: totalAmount } };
  }
}

export type {
  PlanRow,
  SubscriptionRow,
  NewSubscriptionRow,
  InvoiceRow,
  NewInvoiceRow,
};
export type { PaymentPurpose };
