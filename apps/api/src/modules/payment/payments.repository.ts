import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { payments, type NewPaymentRow, type PaymentRow } from '../../db/schema/billing.js';
import type { PaymentPurpose, PaymentStatus, PaymentProvider } from '@app/contracts';

/** DI token for the payment repository (tests bind a fake). */
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');

/**
 * The narrow fake-able surface: the Postgres reads/writes a PaymentService
 * needs. Kept small so the in-memory fake in tests stays trivial.
 */
export interface PaymentsRepositoryLike {
  /** Find a payment by its primary id (returns null when absent). */
  findById(id: string): Promise<PaymentRow | null>;
  /** Find a payment by its idempotency key (the double-charge guard). */
  findByIdempotencyKey(key: string): Promise<PaymentRow | null>;
  /** Find the most recent payment for a (purpose, purposeId) — for verify-after-callback. */
  findLatestForPurpose(
    purpose: PaymentPurpose,
    purposeId: string,
  ): Promise<PaymentRow | null>;
  /** List the caller's payments, optionally filtered by purpose/status. */
  listByUser(
    userId: string,
    opts: { purpose?: PaymentPurpose; status?: PaymentStatus; limit: number; offset: number },
  ): Promise<{ items: PaymentRow[]; total: number }>;
  /** Insert a fresh payment row (status defaults to 'pending'). */
  insert(row: NewPaymentRow): Promise<PaymentRow>;
  /**
   * Patch a payment row. Returns the updated row (or null if the id vanished
   * between the read + the write — a race the service tolerates).
   */
  update(
    id: string,
    patch: Partial<{
      status: PaymentStatus;
      authority: string | null;
      referenceId: string | null;
      gatewayUrl: string | null;
      verifiedAt: Date | null;
    }>,
  ): Promise<PaymentRow | null>;
}

@Injectable()
export class PaymentsRepository implements PaymentsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findById(id: string): Promise<PaymentRow | null> {
    const rows = await this.client.db.select().from(payments).where(eq(payments.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<PaymentRow | null> {
    const rows = await this.client.db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async findLatestForPurpose(
    purpose: PaymentPurpose,
    purposeId: string,
  ): Promise<PaymentRow | null> {
    const rows = await this.client.db
      .select()
      .from(payments)
      .where(and(eq(payments.purpose, purpose), eq(payments.purposeId, purposeId)))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByUser(
    userId: string,
    opts: { purpose?: PaymentPurpose; status?: PaymentStatus; limit: number; offset: number },
  ): Promise<{ items: PaymentRow[]; total: number }> {
    const conds = [eq(payments.userId, userId)];
    if (opts.purpose) conds.push(eq(payments.purpose, opts.purpose));
    if (opts.status) conds.push(eq(payments.status, opts.status));
    const where = conds.length === 1 ? conds[0]! : and(...conds);
    const items = await this.client.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    // Count the matching rows for pagination meta.
    const countRows = await this.client.db
      .select({ count: payments.id })
      .from(payments)
      .where(where);
    return { items, total: countRows.length };
  }

  async insert(row: NewPaymentRow): Promise<PaymentRow> {
    const inserted = await this.client.db.insert(payments).values(row).returning();
    return inserted[0]!;
  }

  async update(
    id: string,
    patch: Partial<{
      status: PaymentStatus;
      authority: string | null;
      referenceId: string | null;
      gatewayUrl: string | null;
      verifiedAt: Date | null;
    }>,
  ): Promise<PaymentRow | null> {
    const updated = await this.client.db
      .update(payments)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(payments.id, id))
      .returning();
    return updated[0] ?? null;
  }
}

/** Re-exported so the module + service import the row type from one place. */
export type { PaymentRow, NewPaymentRow };
export type PaymentProviderValue = PaymentProvider;
