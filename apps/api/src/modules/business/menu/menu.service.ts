import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type BusinessStatus,
  type MenuResponse,
  type MenuSectionInput,
  type ReplaceMenuBody,
} from '@app/contracts';
import { MENU_REPOSITORY, type MenuRepositoryLike } from './menu.repository.js';
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
 * Menu / services of a business (B2.8). The whole menu is replaced ATOMICALLY
 * (PUT) — the same full-replace semantics B2.5 chose for weekly hours; item
 * photos are uploaded separately (B1.9, kind `menu_photo`) and referenced by
 * media id in the payload.
 *
 * Photo rules at replace time:
 *  - the media must be kind `menu_photo`, not soft-deleted, owned by the
 *    caller (admins manage only their own uploads here, mirroring B2.7);
 *  - a media id already referenced by THIS business's CURRENT menu keeps
 *    working (an edit that keeps the photo does not re-attach anything);
 *  - an unattached media is marked attached AFTER the replace commits —
 *    if that marking fails the FK is SET NULL-directional (the hourly orphan
 *    sweep would eventually null the photo, never strand the item);
 *  - a media id attached to ANYTHING ELSE → 409;
 *  - media ids referenced by the OLD menu but dropped from the new payload
 *    are soft-deleted through MediaService after commit (physical removal is
 *    queued on the worker).
 */
@Injectable()
export class MenuService {
  constructor(
    @Inject(MENU_REPOSITORY) private readonly repo: MenuRepositoryLike,
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
    if (!ctx || ctx.deletedAt) throw notFoundException('Business', businessId);
    return { ownerId: ctx.ownerId, status: ctx.status as BusinessStatus };
  }

  /** The full menu tree (sections with their items, in stored order). */
  async getMenu(businessId: string): Promise<MenuResponse> {
    const [sections, items] = await Promise.all([
      this.repo.findSections(businessId),
      this.repo.findItems(businessId),
    ]);
    const bySection = new Map<string, MenuResponse['sections'][number]['items'][number][]>();
    for (const item of items) {
      const list = bySection.get(item.sectionId) ?? [];
      list.push({
        id: item.id,
        sectionId: item.sectionId,
        name: item.name,
        description: item.description,
        price: item.price,
        photoUrl: this.mediaUrls.urlFor(item.photoKey),
        photoThumbUrl: this.mediaUrls.urlFor(item.photoThumbKey),
        isAvailable: item.isAvailable,
        sortOrder: item.sortOrder,
      });
      bySection.set(item.sectionId, list);
    }
    return {
      sections: sections.map((s) => ({
        id: s.id,
        businessId: s.businessId,
        name: s.name,
        sortOrder: s.sortOrder,
        items: bySection.get(s.id) ?? [],
      })),
    };
  }

  /**
   * Replace the whole menu with the payload snapshot (rows are recreated —
   * the payload BECOMES the menu; response ids are server-issued). Rules the
   * Zod schema cannot express: photoMediaId uniqueness across the payload
   * (422), and the per-media kind/ownership/attachment checks described in
   * the class doc.
   */
  async replaceMenu(
    businessId: string,
    user: BusinessActor,
    body: ReplaceMenuBody,
  ): Promise<MenuResponse> {
    const newPhotoIds = this.collectPhotoIds(body.sections);
    const currentItems = await this.repo.findItems(businessId);
    const currentPhotoIds = new Set(
      currentItems.map((i) => i.photoMediaId).filter((id): id is string => Boolean(id)),
    );

    // Validate every referenced photo BEFORE touching the menu.
    for (const mediaId of newPhotoIds) {
      const media = await this.mediaRepo.findById(mediaId);
      if (!media || media.deletedAt) throw notFoundException('Media', mediaId);
      if (media.kind !== 'menu_photo') {
        throw ruleException(`Media kind ${media.kind} cannot be used as a menu photo`, {
          mediaId,
          kind: media.kind,
        });
      }
      if (media.ownerUserId !== user.id) {
        throw new HttpException(
          {
            code: 'FORBIDDEN' as const,
            messageKey: 'errors.forbidden',
            message: 'Only the uploader may reference this media',
          },
          HttpStatus.FORBIDDEN,
        );
      }
      if (media.attachedAt && !currentPhotoIds.has(mediaId)) {
        throw new ConflictException({
          code: 'CONFLICT' as const,
          messageKey: 'errors.conflict',
          message: 'Media is already attached elsewhere',
          details: { mediaId },
        });
      }
    }

    const newIdSet = new Set(newPhotoIds);
    await this.repo.replaceMenu(businessId, body.sections);

    // Post-commit side effects (each failure is non-fatal by design — see the
    // class doc): mark NEW photos attached; soft-delete dropped photos.
    for (const mediaId of newPhotoIds) {
      const media = await this.mediaRepo.findById(mediaId);
      if (media && !media.attachedAt) {
        await this.media.markAttached(mediaId, user.id).catch(() => undefined);
      }
    }
    for (const mediaId of currentPhotoIds) {
      if (!newIdSet.has(mediaId)) {
        await this.media
          .deleteOwned(mediaId, { id: user.id, role: user.role })
          .catch(() => undefined);
      }
    }

    return this.getMenu(businessId);
  }

  /** photoMediaId must be unique across the whole payload (422 on a duplicate). */
  private collectPhotoIds(sections: MenuSectionInput[]): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const section of sections) {
      for (const item of section.items) {
        const photo = item.photoMediaId;
        if (!photo) continue;
        if (seen.has(photo)) {
          throw ruleException('photoMediaId is used by more than one item', {
            photoMediaId: photo,
          });
        }
        seen.add(photo);
        ids.push(photo);
      }
    }
    return ids;
  }
}
