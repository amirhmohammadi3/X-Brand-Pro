import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type BusinessClaim,
  type BusinessClaimStatus,
  type CreateBusinessClaimBody,
  type ReviewBusinessClaimBody,
} from '@app/contracts';
import {
  CLAIMS_REPOSITORY,
  type ClaimWithMedia,
  type ClaimsRepositoryLike,
} from './claims.repository.js';
import { MEDIA_REPOSITORY, type MediaRepositoryLike } from '../../media/media.repository.js';
import { MEDIA_SERVICE } from '../../media/media.service.js';
import type { MediaService } from '../../media/media.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../../media/media-url.service.js';
import type { BusinessActor } from '../business-access.js';

function notFoundException(what: string, id: string): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND' as const,
    messageKey: 'errors.not_found',
    message: `${what} ${id} not found`,
    details: { entity: what.toLowerCase(), id },
  });
}

function conflictException(message: string, details?: unknown): ConflictException {
  return new ConflictException({
    code: 'CONFLICT' as const,
    messageKey: 'errors.conflict',
    message,
    details,
  });
}

function ruleException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message,
      details,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Ownership claims (B2.9). A user claims an UNCLAIMED business (owner_id
 * null AND is_claimed false) with evidence text + an optional uploaded
 * document (kind `claim_document`, B1.9). An admin (`businesses.manage`)
 * approves (ownership lands in one transaction with the claim closing) or
 * rejects (note required by the schema). The claimant may cancel their own
 * pending claim.
 *
 * Document flow mirrors the B2.7/B2.8 attach pattern: the claim row is
 * inserted first and the media marked attached second — a crash between the
 * two self-heals (the hourly orphan sweep deletes the never-attached media
 * and the FK SET NULLs the claim's document reference). Validation happens
 * BEFORE the insert so a bad document never creates a claim.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(CLAIMS_REPOSITORY) private readonly repo: ClaimsRepositoryLike,
    @Inject(MEDIA_REPOSITORY) private readonly mediaRepo: MediaRepositoryLike,
    @Inject(MEDIA_SERVICE) private readonly media: MediaService,
    private readonly mediaUrls: MediaUrlService,
  ) {}

  /** 404 (never leak existence) unless the business exists and is not deleted. */
  async getBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    isClaimed: boolean;
  }> {
    const ctx = await this.repo.findBusinessContext(businessId);
    if (!ctx || ctx.deletedAt) throw notFoundException('Business', businessId);
    return { ownerId: ctx.ownerId, isClaimed: ctx.isClaimed };
  }

  /**
   * File a claim on an unclaimed business. The caller must not already own
   * it (a re-claim of one's own business is a no-op concept, not a review
   * task), the business must be unclaimed, and at most one pending claim may
   * exist per business (also enforced by the partial unique index).
   */
  async create(
    businessId: string,
    user: BusinessActor,
    body: CreateBusinessClaimBody,
  ): Promise<BusinessClaim> {
    const ctx = await this.getBusinessContext(businessId);
    if (ctx.ownerId === user.id) {
      throw conflictException('You already own this business', { businessId });
    }
    if (ctx.ownerId !== null || ctx.isClaimed) {
      throw conflictException('Business is already claimed', { businessId });
    }
    const pending = await this.repo.findPendingByBusiness(businessId);
    if (pending) {
      throw conflictException('A claim is already pending for this business', {
        businessId,
        claimId: pending.id,
      });
    }

    if (body.documentMediaId) {
      const media = await this.mediaRepo.findById(body.documentMediaId);
      if (!media || media.deletedAt) {
        throw notFoundException('Media', body.documentMediaId);
      }
      if (media.kind !== 'claim_document') {
        throw ruleException(`Media kind ${media.kind} cannot be used as claim evidence`, {
          mediaId: body.documentMediaId,
          kind: media.kind,
        });
      }
      if (media.ownerUserId !== user.id) {
        throw new ForbiddenException({
          code: 'FORBIDDEN' as const,
          messageKey: 'errors.forbidden',
          message: 'Only the uploader may reference this media',
        });
      }
      if (media.attachedAt) {
        throw conflictException('Media is already attached', {
          mediaId: body.documentMediaId,
        });
      }
    }

    const row = await this.repo.insert({
      businessId,
      claimantUserId: user.id,
      evidence: body.evidence, // length 20..2000 enforced by the schema
      documentMediaId: body.documentMediaId ?? null,
    });
    if (body.documentMediaId) {
      await this.media.markAttached(body.documentMediaId, user.id).catch(() => undefined);
    }
    return this.toClaim(row);
  }

  /** The business's claim history — admin only (businesses.manage). */
  async listByBusiness(businessId: string): Promise<BusinessClaim[]> {
    await this.getBusinessContext(businessId);
    const rows = await this.repo.listByBusiness(businessId);
    return rows.map((row) => this.toClaim(row));
  }

  /** The caller's own claims (any status). */
  async listMine(user: BusinessActor): Promise<BusinessClaim[]> {
    const rows = await this.repo.listByClaimant(user.id);
    return rows.map((row) => this.toClaim(row));
  }

  /**
   * Admin review. Approve lands ownership (transactional in the repository);
   * reject requires the note (schema-enforced; re-checked here so the
   * service is safe without the pipe).
   */
  async review(
    claimId: string,
    admin: BusinessActor,
    body: ReviewBusinessClaimBody,
  ): Promise<BusinessClaim> {
    const claim = await this.repo.findById(claimId);
    if (!claim) throw notFoundException('Claim', claimId);
    if (claim.status !== 'pending') {
      throw conflictException(`Claim is not pending (status: ${claim.status})`, { claimId });
    }
    if (body.decision === 'reject' && !body.adminNote) {
      throw ruleException('adminNote is required when rejecting', { claimId });
    }
    if (body.decision === 'approve') {
      // The business must still be unclaimed at review time (race with admin
      // assignment/imports); the repository re-checks owner_id IS NULL in its
      // transaction, and a claimed business fails here with a clear error.
      const ctx = await this.repo.findBusinessContext(claim.businessId);
      if (!ctx || ctx.deletedAt) throw notFoundException('Business', claim.businessId);
      if (ctx.ownerId !== null || ctx.isClaimed) {
        throw conflictException('Business is already claimed', { businessId: claim.businessId });
      }
      await this.repo.approve(claimId, admin.id, claim.businessId, claim.claimantUserId);
    } else {
      await this.repo.reject(claimId, admin.id, body.adminNote!);
    }
    const updated = await this.repo.findById(claimId);
    if (!updated) throw notFoundException('Claim', claimId);
    return this.toClaim(updated);
  }

  /** The claimant withdraws their own pending claim (a terminal status). */
  async cancel(claimId: string, user: BusinessActor): Promise<BusinessClaim> {
    const claim = await this.repo.findById(claimId);
    if (!claim) throw notFoundException('Claim', claimId);
    if (claim.claimantUserId !== user.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN' as const,
        messageKey: 'errors.forbidden',
        message: 'Not your claim',
      });
    }
    if (claim.status !== 'pending') {
      throw conflictException(`Claim is not pending (status: ${claim.status})`, { claimId });
    }
    await this.repo.cancel(claimId);
    const updated = await this.repo.findById(claimId);
    if (!updated) throw notFoundException('Claim', claimId);
    return this.toClaim(updated);
  }

  private toClaim(row: ClaimWithMedia): BusinessClaim {
    return {
      id: row.id,
      businessId: row.businessId,
      claimantUserId: row.claimantUserId,
      status: row.status as BusinessClaimStatus,
      evidence: row.evidence,
      documentUrl: this.mediaUrls.urlFor(row.documentKey),
      reviewedBy: row.reviewedBy,
      adminNote: row.adminNote,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
