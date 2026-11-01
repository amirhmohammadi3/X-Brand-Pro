import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { mediaFiles, type MediaFileRow } from '../../db/schema/media.js';

/** DI token for the media repository (overridden with a fake in tests). */
export const MEDIA_REPOSITORY = Symbol('MEDIA_REPOSITORY');

/**
 * All Drizzle access for the media domain lives here (AGENTS.md 6: services
 * never import `db` directly). The narrow method set doubles as the interface
 * unit/integration tests fake (media.api.spec overrides this token).
 */
export interface MediaRepositoryLike {
  insert(row: {
    id?: string;
    ownerUserId: string | null;
    kind: MediaFileRow['kind'];
    key: string;
    thumbKey: string | null;
    mime: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }): Promise<MediaFileRow>;
  findById(id: string): Promise<MediaFileRow | null>;
  findByKey(key: string): Promise<MediaFileRow | null>;
  /** Sets attached_at unless it is already set (idempotent). Returns the row. */
  markAttached(id: string): Promise<MediaFileRow | null>;
  /** Soft delete (deleted_at = now). Returns the updated row, or null. */
  softDelete(id: string): Promise<MediaFileRow | null>;
  /** Rows that were never attached and are older than `olderThan`. */
  findUnattachedOlderThan(olderThan: Date, limit: number): Promise<MediaFileRow[]>;
  /** Hard delete of the row itself (cleanup + owner deletion follow-up). */
  deleteRow(id: string): Promise<void>;
  /** Rows soft-deleted before `deletedBefore` whose files still need removal. */
  findSoftDeletedBefore(deletedBefore: Date, limit: number): Promise<MediaFileRow[]>;
}

@Injectable()
export class MediaRepository implements MediaRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async insert(row: Parameters<MediaRepositoryLike['insert']>[0]): Promise<MediaFileRow> {
    const rows = await this.client.db.insert(mediaFiles).values(row).returning();
    const created = rows[0];
    if (!created) throw new Error('media_files insert returned no row');
    return created;
  }

  async findById(id: string): Promise<MediaFileRow | null> {
    const [row] = await this.client.db.select().from(mediaFiles).where(eq(mediaFiles.id, id));
    return row ?? null;
  }

  async findByKey(key: string): Promise<MediaFileRow | null> {
    const [row] = await this.client.db.select().from(mediaFiles).where(eq(mediaFiles.key, key));
    return row ?? null;
  }

  async markAttached(id: string): Promise<MediaFileRow | null> {
    const [row] = await this.client.db
      .update(mediaFiles)
      .set({ attachedAt: new Date() })
      .where(and(eq(mediaFiles.id, id), isNull(mediaFiles.attachedAt)))
      .returning();
    // Idempotent: already-attached rows are returned unchanged.
    if (row) return row;
    return this.findById(id);
  }

  async softDelete(id: string): Promise<MediaFileRow | null> {
    const [row] = await this.client.db
      .update(mediaFiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(mediaFiles.id, id), isNull(mediaFiles.deletedAt)))
      .returning();
    return row ?? null;
  }

  async findUnattachedOlderThan(olderThan: Date, limit: number): Promise<MediaFileRow[]> {
    return this.client.db
      .select()
      .from(mediaFiles)
      .where(
        and(
          isNull(mediaFiles.attachedAt),
          isNull(mediaFiles.deletedAt),
          lt(mediaFiles.createdAt, olderThan),
        ),
      )
      .limit(limit);
  }

  async deleteRow(id: string): Promise<void> {
    await this.client.db.delete(mediaFiles).where(eq(mediaFiles.id, id));
  }

  async findSoftDeletedBefore(deletedBefore: Date, limit: number): Promise<MediaFileRow[]> {
    return this.client.db
      .select()
      .from(mediaFiles)
      .where(and(isNotNull(mediaFiles.deletedAt), lt(mediaFiles.deletedAt, deletedBefore)))
      .limit(limit);
  }
}
