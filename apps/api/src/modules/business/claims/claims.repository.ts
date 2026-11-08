import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { businessClaims } from '../../../db/schema/claims.js';
import { businesses } from '../../../db/schema/business.js';
import { mediaFiles } from '../../../db/schema/media.js';
import type { BusinessClaimStatus } from '@app/contracts';

/** DI token for the claims repository (tests bind a fake). */
export const CLAIMS_REPOSITORY = Symbol('CLAIMS_REPOSITORY');

/** Claim row joined with the document media key (URL resolution in the service). */
export interface ClaimWithMedia {
  id: string;
  businessId: string;
  claimantUserId: string;
  status: BusinessClaimStatus;
  evidence: string;
  documentMediaId: string | null;
  documentKey: string | null;
  reviewedBy: string | null;
  adminNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** The narrow fake-able surface consumed by ClaimsService + B2.9's HTTP layer. */
export interface ClaimsRepositoryLike {
  findBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    isClaimed: boolean;
    deletedAt: Date | null;
  } | null>;
  /** The business's CURRENT pending claim, if any (one-pending guarantee). */
  findPendingByBusiness(businessId: string): Promise<ClaimWithMedia | null>;
  findById(claimId: string): Promise<ClaimWithMedia | null>;
  listByBusiness(businessId: string): Promise<ClaimWithMedia[]>;
  listByClaimant(claimantUserId: string): Promise<ClaimWithMedia[]>;
  /** Insert a pending claim; returns the full row (document key joined back). */
  insert(input: {
    businessId: string;
    claimantUserId: string;
    evidence: string;
    documentMediaId: string | null;
  }): Promise<ClaimWithMedia>;
  /**
   * APPROVE: claim → approved AND ownership assigned + is_claimed flipped, in
   * ONE transaction — a claim must never be approved without the ownership
   * landing, nor ownership assigned without the claim closing. The ownership
   * update carries `WHERE owner_id IS NULL` so a business that gained an owner
   * (import/admin assignment) in the meantime cannot be re-owned.
   */
  approve(
    claimId: string,
    reviewedBy: string,
    businessId: string,
    claimantUserId: string,
  ): Promise<void>;
  reject(claimId: string, reviewedBy: string, adminNote: string): Promise<void>;
  cancel(claimId: string): Promise<void>;
}

const CLAIM_SELECT = {
  id: businessClaims.id,
  businessId: businessClaims.businessId,
  claimantUserId: businessClaims.claimantUserId,
  status: businessClaims.status,
  evidence: businessClaims.evidence,
  documentMediaId: businessClaims.documentMediaId,
  documentKey: mediaFiles.key,
  reviewedBy: businessClaims.reviewedBy,
  adminNote: businessClaims.adminNote,
  decidedAt: businessClaims.decidedAt,
  createdAt: businessClaims.createdAt,
};

/**
 * Claims persistence (B2.9) over `business_claims` (migration 0018). Approve
 * is the only multi-table write and runs in one transaction. Claim approval
 * does NOT activate the business — the status state machine stays with B2.6.
 */
@Injectable()
export class ClaimsRepository implements ClaimsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(
    businessId: string,
  ): Promise<{ ownerId: string | null; isClaimed: boolean; deletedAt: Date | null } | null> {
    const rows = await this.client.db
      .select({
        ownerId: businesses.ownerId,
        isClaimed: businesses.isClaimed,
        deletedAt: businesses.deletedAt,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row;
  }

  async findPendingByBusiness(businessId: string): Promise<ClaimWithMedia | null> {
    const rows = await this.client.db
      .select(CLAIM_SELECT)
      .from(businessClaims)
      .leftJoin(mediaFiles, eq(mediaFiles.id, businessClaims.documentMediaId))
      .where(and(eq(businessClaims.businessId, businessId), eq(businessClaims.status, 'pending')))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(claimId: string): Promise<ClaimWithMedia | null> {
    const rows = await this.client.db
      .select(CLAIM_SELECT)
      .from(businessClaims)
      .leftJoin(mediaFiles, eq(mediaFiles.id, businessClaims.documentMediaId))
      .where(eq(businessClaims.id, claimId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByBusiness(businessId: string): Promise<ClaimWithMedia[]> {
    return this.client.db
      .select(CLAIM_SELECT)
      .from(businessClaims)
      .leftJoin(mediaFiles, eq(mediaFiles.id, businessClaims.documentMediaId))
      .where(eq(businessClaims.businessId, businessId))
      .orderBy(desc(businessClaims.createdAt));
  }

  async listByClaimant(claimantUserId: string): Promise<ClaimWithMedia[]> {
    return this.client.db
      .select(CLAIM_SELECT)
      .from(businessClaims)
      .leftJoin(mediaFiles, eq(mediaFiles.id, businessClaims.documentMediaId))
      .where(eq(businessClaims.claimantUserId, claimantUserId))
      .orderBy(desc(businessClaims.createdAt));
  }

  async insert(input: {
    businessId: string;
    claimantUserId: string;
    evidence: string;
    documentMediaId: string | null;
  }): Promise<ClaimWithMedia> {
    const inserted = await this.client.db
      .insert(businessClaims)
      .values({
        businessId: input.businessId,
        claimantUserId: input.claimantUserId,
        evidence: input.evidence,
        documentMediaId: input.documentMediaId,
      })
      .returning({ id: businessClaims.id });
    const row = inserted[0];
    if (!row) throw new Error('business_claims insert returned no rows');
    const created = await this.findById(row.id);
    if (!created) throw new Error('business_claims insert vanished');
    return created;
  }

  async approve(
    claimId: string,
    reviewedBy: string,
    businessId: string,
    claimantUserId: string,
  ): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      await tx
        .update(businessClaims)
        .set({ status: 'approved', reviewedBy, decidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(businessClaims.id, claimId), eq(businessClaims.status, 'pending')));
      await tx
        .update(businesses)
        .set({ ownerId: claimantUserId, isClaimed: true, updatedAt: new Date() })
        .where(and(eq(businesses.id, businessId), isNull(businesses.ownerId)));
    });
  }

  async reject(claimId: string, reviewedBy: string, adminNote: string): Promise<void> {
    await this.client.db
      .update(businessClaims)
      .set({
        status: 'rejected',
        reviewedBy,
        adminNote,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(businessClaims.id, claimId), eq(businessClaims.status, 'pending')));
  }

  async cancel(claimId: string): Promise<void> {
    await this.client.db
      .update(businessClaims)
      .set({ status: 'cancelled', decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(businessClaims.id, claimId), eq(businessClaims.status, 'pending')));
  }
}
