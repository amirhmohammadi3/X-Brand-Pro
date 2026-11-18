import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  invoices,
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
}

export type {
  PlanRow,
  SubscriptionRow,
  NewSubscriptionRow,
  InvoiceRow,
  NewInvoiceRow,
};
export type { PaymentPurpose };
