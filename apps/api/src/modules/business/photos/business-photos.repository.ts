import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { businessPhotos, businesses } from '../../../db/schema/business.js';
import { mediaFiles } from '../../../db/schema/media.js';

/** DI token for the business-photos repository (tests bind a fake). */
export const BUSINESS_PHOTOS_REPOSITORY = Symbol('BUSINESS_PHOTOS_REPOSITORY');

/**
 * One gallery entry joined with the media row it points at. `key`/`thumbKey`
 * are the storage addresses; the service maps them to public URLs through
 * MediaUrlService (the same scheme every other media consumer uses).
 */
export interface BusinessPhotoWithMedia {
  id: string;
  businessId: string;
  mediaId: string;
  sortOrder: number;
  createdAt: Date;
  key: string;
  thumbKey: string | null;
  width: number | null;
  height: number | null;
}

/**
 * The narrow fake-able surface consumed by PhotosService + B2.7's HTTP layer.
 * Cover reads/writes live here too (they UPDATE `businesses`, but they are the
 * photo flow's writes — keeping them in one fake-able surface keeps the
 * service tests DB-free).
 */
export interface BusinessPhotosRepositoryLike {
  /** Existence + ownership + status of the business (404-never-leak rule). */
  findBusinessContext(
    businessId: string,
  ): Promise<{ ownerId: string | null; status: string; deletedAt: Date | null } | null>;
  listByBusiness(businessId: string): Promise<BusinessPhotoWithMedia[]>;
  findById(photoId: string): Promise<BusinessPhotoWithMedia | null>;
  /** The gallery entry a media id is attached to, if any (attach conflicts). */
  findByMediaId(mediaId: string): Promise<BusinessPhotoWithMedia | null>;
  countByBusiness(businessId: string): Promise<number>;
  maxSortOrder(businessId: string): Promise<number>;
  insert(businessId: string, mediaId: string, sortOrder: number): Promise<BusinessPhotoWithMedia>;
  /** Full-permutation reorder: `orderedIds` get sortOrder = index, in one tx. */
  reorder(businessId: string, orderedIds: string[]): Promise<void>;
  delete(photoId: string): Promise<void>;
  findCoverMediaId(businessId: string): Promise<string | null>;
  setCover(businessId: string, mediaId: string): Promise<void>;
  /** Clears the cover only when it still points at `mediaId` (delete race-safe). */
  clearCoverIfSet(businessId: string, mediaId: string): Promise<void>;
}

const PHOTO_SELECT = {
  id: businessPhotos.id,
  businessId: businessPhotos.businessId,
  mediaId: businessPhotos.mediaId,
  sortOrder: businessPhotos.sortOrder,
  createdAt: businessPhotos.createdAt,
  key: mediaFiles.key,
  thumbKey: mediaFiles.thumbKey,
  width: mediaFiles.width,
  height: mediaFiles.height,
};

/**
 * Business photo gallery persistence (B2.7) over `business_photos` (schema in
 * db/schema/business.ts, migration 0016). Joins `media_files` for the URLs;
 * cover writes target `businesses.cover_media_id` (B2.4 column) so the cover
 * can never reference a media row outside the business's own gallery.
 */
@Injectable()
export class BusinessPhotosRepository implements BusinessPhotosRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(
    businessId: string,
  ): Promise<{ ownerId: string | null; status: string; deletedAt: Date | null } | null> {
    const rows = await this.client.db
      .select({
        ownerId: businesses.ownerId,
        status: businesses.status,
        deletedAt: businesses.deletedAt,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ownerId: row.ownerId, status: row.status, deletedAt: row.deletedAt };
  }

  /** Gallery order: sort_order ASC, then created_at ASC (stable ties). */
  async listByBusiness(businessId: string): Promise<BusinessPhotoWithMedia[]> {
    return this.client.db
      .select(PHOTO_SELECT)
      .from(businessPhotos)
      .innerJoin(mediaFiles, eq(mediaFiles.id, businessPhotos.mediaId))
      .where(eq(businessPhotos.businessId, businessId))
      .orderBy(asc(businessPhotos.sortOrder), asc(businessPhotos.createdAt));
  }

  async findById(photoId: string): Promise<BusinessPhotoWithMedia | null> {
    const rows = await this.client.db
      .select(PHOTO_SELECT)
      .from(businessPhotos)
      .innerJoin(mediaFiles, eq(mediaFiles.id, businessPhotos.mediaId))
      .where(eq(businessPhotos.id, photoId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByMediaId(mediaId: string): Promise<BusinessPhotoWithMedia | null> {
    const rows = await this.client.db
      .select(PHOTO_SELECT)
      .from(businessPhotos)
      .innerJoin(mediaFiles, eq(mediaFiles.id, businessPhotos.mediaId))
      .where(eq(businessPhotos.mediaId, mediaId))
      .limit(1);
    return rows[0] ?? null;
  }

  async countByBusiness(businessId: string): Promise<number> {
    const rows = await this.client.db
      .select({ n: sql<number>`count(*)::int` })
      .from(businessPhotos)
      .where(eq(businessPhotos.businessId, businessId));
    return rows[0]?.n ?? 0;
  }

  async maxSortOrder(businessId: string): Promise<number> {
    const rows = await this.client.db
      .select({ max: sql<number>`coalesce(max(${businessPhotos.sortOrder}), -1)::int` })
      .from(businessPhotos)
      .where(eq(businessPhotos.businessId, businessId));
    return rows[0]?.max ?? -1;
  }

  async insert(
    businessId: string,
    mediaId: string,
    sortOrder: number,
  ): Promise<BusinessPhotoWithMedia> {
    const inserted = await this.client.db
      .insert(businessPhotos)
      .values({ businessId, mediaId, sortOrder })
      .returning({ id: businessPhotos.id, createdAt: businessPhotos.createdAt });
    const row = inserted[0];
    if (!row) throw new Error('business_photos insert returned no rows');
    // The media row exists (the service validated it moments ago); its columns
    // are read back here so the returned shape matches the list mapping.
    const media = await this.client.db
      .select({
        key: mediaFiles.key,
        thumbKey: mediaFiles.thumbKey,
        width: mediaFiles.width,
        height: mediaFiles.height,
      })
      .from(mediaFiles)
      .where(eq(mediaFiles.id, mediaId))
      .limit(1);
    const m = media[0];
    if (!m) throw new Error(`media ${mediaId} vanished before photo insert completed`);
    return {
      id: row.id,
      businessId,
      mediaId,
      sortOrder,
      createdAt: row.createdAt,
      key: m.key,
      thumbKey: m.thumbKey,
      width: m.width,
      height: m.height,
    };
  }

  async reorder(businessId: string, orderedIds: string[]): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i];
        if (id === undefined) break;
        await tx
          .update(businessPhotos)
          .set({ sortOrder: i })
          .where(and(eq(businessPhotos.businessId, businessId), eq(businessPhotos.id, id)));
      }
    });
  }

  async delete(photoId: string): Promise<void> {
    await this.client.db.delete(businessPhotos).where(eq(businessPhotos.id, photoId));
  }

  async findCoverMediaId(businessId: string): Promise<string | null> {
    const rows = await this.client.db
      .select({ coverMediaId: businesses.coverMediaId })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return rows[0]?.coverMediaId ?? null;
  }

  async setCover(businessId: string, mediaId: string): Promise<void> {
    await this.client.db
      .update(businesses)
      .set({ coverMediaId: mediaId, updatedAt: new Date() })
      .where(eq(businesses.id, businessId));
  }

  async clearCoverIfSet(businessId: string, mediaId: string): Promise<void> {
    await this.client.db
      .update(businesses)
      .set({ coverMediaId: null, updatedAt: new Date() })
      .where(and(eq(businesses.id, businessId), eq(businesses.coverMediaId, mediaId)));
  }
}
