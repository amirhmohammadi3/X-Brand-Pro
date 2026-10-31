import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { otpCodes, type OtpCodeRow } from '../../db/schema/otp.js';

/** DI token for the OTP repository (faked in unit tests). */
export const OTP_REPOSITORY = Symbol('OTP_REPOSITORY');

/** Narrow Drizzle surface for the OTP domain (AGENTS.md 6). */
export interface OtpRepositoryLike {
  insert(row: {
    id: string;
    purpose: OtpCodeRow['purpose'];
    channel: OtpCodeRow['channel'];
    target: string;
    codeHash: string;
    expiresAt: Date;
    maxAttempts: number;
    ip: string | null;
    userId: string | null;
  }): Promise<OtpCodeRow>;
  /** Latest unconsumed code for target+purpose (created_at desc). */
  findLatestUnconsumed(target: string, purpose: string): Promise<OtpCodeRow | null>;
  /** Atomically bump the attempt counter; returns the new value. */
  incrementAttempts(id: string): Promise<number | null>;
  markConsumed(id: string): Promise<void>;
  /** Invalidate (consume) every unconsumed code for target+purpose. */
  invalidateUnconsumed(target: string, purpose: string): Promise<number>;
  /** Delete rows expired more than `olderThanMs` ago. Returns row count. */
  deleteExpired(olderThanMs: number): Promise<number>;
}

@Injectable()
export class OtpRepository implements OtpRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async insert(row: {
    id: string;
    purpose: OtpCodeRow['purpose'];
    channel: OtpCodeRow['channel'];
    target: string;
    codeHash: string;
    expiresAt: Date;
    maxAttempts: number;
    ip: string | null;
    userId: string | null;
  }): Promise<OtpCodeRow> {
    const rows = await this.client.db.insert(otpCodes).values(row).returning();
    const created = rows[0];
    if (!created) throw new Error('otp_codes insert returned no row');
    return created;
  }

  async findLatestUnconsumed(target: string, purpose: string): Promise<OtpCodeRow | null> {
    const rows = await this.client.db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.target, target),
          eq(otpCodes.purpose, purpose as OtpCodeRow['purpose']),
          isNull(otpCodes.consumedAt),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async incrementAttempts(id: string): Promise<number | null> {
    const rows = await this.client.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id))
      .returning({ attempts: otpCodes.attempts });
    return rows[0]?.attempts ?? null;
  }

  async markConsumed(id: string): Promise<void> {
    await this.client.db
      .update(otpCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpCodes.id, id), isNull(otpCodes.consumedAt)));
  }

  async invalidateUnconsumed(target: string, purpose: string): Promise<number> {
    const rows = await this.client.db
      .update(otpCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(otpCodes.target, target),
          eq(otpCodes.purpose, purpose as OtpCodeRow['purpose']),
          isNull(otpCodes.consumedAt),
        ),
      )
      .returning({ id: otpCodes.id });
    return rows.length;
  }

  async deleteExpired(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.client.db
      .delete(otpCodes)
      .where(lt(otpCodes.expiresAt, cutoff))
      .returning({ id: otpCodes.id });
    return rows.length;
  }
}
