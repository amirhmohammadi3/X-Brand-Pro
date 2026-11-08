import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BUSINESS_MAX_PHOTOS, type BusinessPhoto, type BusinessStatus } from '@app/contracts';
import { MEDIA_REPOSITORY, type MediaRepositoryLike } from '../../media/media.repository.js';
import { MEDIA_SERVICE } from '../../media/media.service.js';
import type { MediaService } from '../../media/media.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../../media/media-url.service.js';
import {
  BUSINESS_PHOTOS_REPOSITORY,
  type BusinessPhotoWithMedia,
  type BusinessPhotosRepositoryLike,
} from './business-photos.repository.js';
import type { BusinessActor } from '../business-access.js';

function notFoundException(what: string, id: string): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND' as const,
    messageKey: 'errors.not_found',
    message: `${what} ${id} not found`,
    details: { entity: what.toLowerCase(), id },
  });
}

function forbiddenException(message: string): HttpException {
  return new HttpException(
    {
      code: 'FORBIDDEN' as const,
      messageKey: 'errors.forbidden',
      message,
    },
    HttpStatus.FORBIDDEN,
  );
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
 * Business photo gallery (B2.7). Uploads stay in B1.9's media flow (POST
 * /media/upload, kind `business_photo`); this service ATTACHES an uploaded
 * media id to a business the caller manages, keeps the order (full-permutation
 * reorder) and the cover (a column on `businesses`, settable only to a media
 * id already in the business's own gallery).
 *
 * Attach ordering is insert-first / mark-attached-second so a crash between
 * the two writes self-heals: an unattached media row is swept by the hourly
 * orphan cleanup and its gallery row cascades away. If markAttached fails the
 * just-inserted gallery row is rolled back, so no partial state survives
 * either failure. A row that EXISTS for the same business is treated as an
 * idempotent retry (the markAttached is re-attempted, then the row returned).
 */
@Injectable()
export class PhotosService {
  constructor(
    @Inject(BUSINESS_PHOTOS_REPOSITORY) private readonly repo: BusinessPhotosRepositoryLike,
    @Inject(MEDIA_REPOSITORY) private readonly mediaRepo: MediaRepositoryLike,
    @Inject(MEDIA_SERVICE) private readonly media: MediaService,
    private readonly mediaUrls: MediaUrlService,
  ) {}

  /** 404 (never leak existence) unless the business exists and is not deleted. */
  async getBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    status: BusinessStatus;
  }> {
    const ctx = await this.repo.findBusinessContext(businessId);
    if (!ctx || ctx.deletedAt) {
      throw notFoundException('Business', businessId);
    }
    return { ownerId: ctx.ownerId, status: ctx.status as BusinessStatus };
  }

  /** The ordered gallery (sort_order ASC, created_at ASC as the stable tiebreak). */
  async list(businessId: string): Promise<BusinessPhoto[]> {
    const rows = await this.repo.listByBusiness(businessId);
    return rows.map((row) => this.toPhoto(row));
  }

  /**
   * Attach an uploaded media id to the business gallery. Validates the media
   * row: exists, not soft-deleted, kind `business_photo`, owned by the caller
   * (admins may attach only their own uploads — matching markAttached's rule),
   * and not already part of another gallery. Enforces BUSINESS_MAX_PHOTOS.
   */
  async attach(businessId: string, user: BusinessActor, mediaId: string): Promise<BusinessPhoto> {
    const existing = await this.repo.findByMediaId(mediaId);
    if (existing && existing.businessId !== businessId) {
      throw conflictException('Media is already attached to another business', {
        mediaId,
        businessId: existing.businessId,
      });
    }
    if (existing) {
      // Idempotent retry of a partially-completed attach (same business).
      await this.media.markAttached(mediaId, user.id);
      return this.toPhoto(existing);
    }

    const media = await this.mediaRepo.findById(mediaId);
    if (!media || media.deletedAt) throw notFoundException('Media', mediaId);
    if (media.kind !== 'business_photo') {
      throw ruleException(`Media kind ${media.kind} cannot be attached as a business photo`, {
        mediaId,
        kind: media.kind,
      });
    }
    if (media.ownerUserId !== user.id) {
      throw forbiddenException('Only the uploader may attach this media');
    }
    if (media.attachedAt) {
      // Attached but no gallery row anywhere: the media is committed to
      // another flow (avatar/review/...), never a gallery.
      throw conflictException('Media is already attached', { mediaId });
    }

    const count = await this.repo.countByBusiness(businessId);
    if (count >= BUSINESS_MAX_PHOTOS) {
      throw ruleException(`A business can have at most ${BUSINESS_MAX_PHOTOS} photos`, {
        limit: BUSINESS_MAX_PHOTOS,
      });
    }

    const max = await this.repo.maxSortOrder(businessId);
    const row = await this.repo.insert(businessId, mediaId, max + 1);
    try {
      await this.media.markAttached(mediaId, user.id);
    } catch (err) {
      await this.repo.delete(row.id).catch(() => undefined);
      throw err;
    }
    return this.toPhoto(row);
  }

  /**
   * Set the gallery order. `photoIds` must be an exact permutation of the
   * current gallery — no unknown id (404), no duplicate, no omission (422) —
   * so a stale client can never silently drop photos.
   */
  async reorder(businessId: string, photoIds: string[]): Promise<BusinessPhoto[]> {
    const current = await this.repo.listByBusiness(businessId);
    const currentIds = new Set(current.map((p) => p.id));
    const seen = new Set<string>();
    for (const id of photoIds) {
      if (!currentIds.has(id)) throw notFoundException('Photo', id);
      if (seen.has(id)) {
        throw ruleException('photoIds contains a duplicate id', { photoId: id });
      }
      seen.add(id);
    }
    if (seen.size !== current.length) {
      throw ruleException('photoIds must include every gallery photo exactly once', {
        expected: current.length,
        received: seen.size,
      });
    }
    await this.repo.reorder(businessId, photoIds);
    return this.list(businessId);
  }

  /**
   * Remove one photo: the gallery row goes away, a cover pointing at its media
   * is cleared in the same flow, and the media itself is soft-deleted through
   * MediaService (owner or businesses-manage holder — the controller has
   * already enforced manage rights on the business), which queues the physical
   * file removal on the worker.
   */
  async remove(businessId: string, photoId: string, user: BusinessActor): Promise<void> {
    const photo = await this.repo.findById(photoId);
    if (!photo || photo.businessId !== businessId) {
      throw notFoundException('Photo', photoId);
    }
    await this.repo.delete(photoId);
    await this.repo.clearCoverIfSet(businessId, photo.mediaId);
    await this.media.deleteOwned(photo.mediaId, { id: user.id, role: user.role });
  }

  /** The cover must be one of THIS business's gallery media ids. */
  async setCover(businessId: string, mediaId: string): Promise<BusinessPhoto[]> {
    const photo = await this.repo.findByMediaId(mediaId);
    if (!photo || photo.businessId !== businessId) {
      throw notFoundException('Photo', mediaId);
    }
    await this.repo.setCover(businessId, mediaId);
    return this.list(businessId);
  }

  /** Map a joined row to the contract shape (URL scheme from MediaUrlService). */
  private toPhoto(row: BusinessPhotoWithMedia): BusinessPhoto {
    const url = this.mediaUrls.urlFor(row.key);
    if (!url) throw new Error(`media row ${row.mediaId} has an empty key`);
    return {
      id: row.id,
      businessId: row.businessId,
      mediaId: row.mediaId,
      url,
      thumbUrl: this.mediaUrls.urlFor(row.thumbKey),
      width: row.width,
      height: row.height,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
