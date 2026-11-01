import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { OutputInfo } from 'sharp';
import type { MediaKind, UploadMediaResponse } from '@app/contracts';
import {
  ACCEPTED_DOCUMENT_MIMES,
  ACCEPTED_IMAGE_MIMES,
  MEDIA_MAX_BYTES,
  PROCESSED_IMAGE_MIME,
  isPublicMediaKind,
} from '@app/contracts';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { StorageDriver } from '../storage/storage.driver.js';
import { STORAGE_DRIVER } from '../storage/storage.driver.js';
import { QUEUES_SERVICE } from '../../queue/queue.module.js';
import type { QueuesService } from '../../queue/queues.service.js';
import type { MediaRepositoryLike } from './media.repository.js';
import { MEDIA_REPOSITORY } from './media.repository.js';
import type { MediaFileRow } from '../../db/schema/media.js';

/** Long-edge cap for stored images (thumbnails are capped at 400). */
const MAX_IMAGE_EDGE = 2560;
const THUMB_EDGE = 400;
const MAIN_WEBP_QUALITY = 82;
const THUMB_WEBP_QUALITY = 75;
/** Orphan window: uploads that were never attached are removed after this. */
const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;
/** Hourly schedule of the `media:cleanup-orphans` repeatable (B1.9). */
export const MEDIA_CLEANUP_EVERY_MS = 60 * 60 * 1000;
export const MEDIA_CLEANUP_JOB = 'media:cleanup-orphans';

/** DI token for MediaService (lets tests bind a partial fake if ever needed). */
export const MEDIA_SERVICE = Symbol('MEDIA_SERVICE');

/** BullMQ queue carrying file-removal jobs (worker process only). */
export const MEDIA_QUEUE = 'media';

export type DeleteMediaJobData = { keys: string[] };

/** Thrown with a contracts error code + HTTP status (envelope-friendly). */
export class MediaError extends HttpException {
  constructor(
    public readonly code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'UNPROCESSABLE',
    message: string,
    details?: unknown,
  ) {
    super({ code, message, details }, MediaError.statusOf(code));
  }

  private static statusOf(code: MediaError['code']): number {
    switch (code) {
      case 'PAYLOAD_TOO_LARGE':
        return HttpStatus.PAYLOAD_TOO_LARGE; // 413
      case 'UNSUPPORTED_MEDIA_TYPE':
        return HttpStatus.UNSUPPORTED_MEDIA_TYPE; // 415
      case 'UNPROCESSABLE':
        return HttpStatus.UNPROCESSABLE_ENTITY; // 422
    }
  }
}

/**
 * Media processing (B1.9). Every upload is sniffed by magic bytes (file-type),
 * never trusted by name or client mime; images are re-encoded with sharp
 * (EXIF orientation applied, ALL metadata stripped, capped at 2560 px, WebP
 * q82) plus a 400 px WebP thumbnail; PDFs for document kinds are stored
 * untouched. All storage goes through the StorageDriver.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(MEDIA_REPOSITORY) private readonly repo: MediaRepositoryLike,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(QUEUES_SERVICE) private readonly queues: QueuesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Validate + process + store an upload. Returns the public response
   * (urls point at MEDIA_PUBLIC_BASE, served by MediaServingController).
   */
  async saveImage(
    file: { buffer: Buffer; originalName: string; size: number },
    opts: { kind: MediaKind; ownerId: string },
  ): Promise<UploadMediaResponse> {
    const { kind, ownerId } = opts;
    const maxBytes = MEDIA_MAX_BYTES[kind];
    if (file.size > maxBytes) {
      throw new MediaError('PAYLOAD_TOO_LARGE', `File exceeds the ${kind} limit`, {
        limit: maxBytes,
        received: file.size,
      });
    }

    const realMime = await this.sniffMime(file.buffer);
    if (!realMime) {
      // No magic bytes matched: a text file renamed .jpg, random bytes, SVG
      // (text-based, never detected) — all rejected before any decode.
      throw new MediaError('UNPROCESSABLE', 'Unrecognized file content');
    }

    const imageAllowed = (ACCEPTED_IMAGE_MIMES as readonly string[]).includes(realMime);
    const documentAllowed = (ACCEPTED_DOCUMENT_MIMES as readonly string[]).includes(realMime);
    const acceptsDocuments = kind === 'claim_document' || kind === 'message_attachment';
    if (acceptsDocuments && documentAllowed) {
      return this.storeRaw(file.buffer, { kind, ownerId, mime: realMime, ext: 'pdf' });
    }
    if (imageAllowed) {
      return this.storeImage(file.buffer, { kind, ownerId, mime: realMime });
    }
    // A valid file of the wrong type (e.g. a PDF for an avatar, a GIF).
    throw new MediaError('UNSUPPORTED_MEDIA_TYPE', `Type ${realMime} is not allowed for ${kind}`);
  }

  /** file-type is ESM-only; the api package is CJS, so import it dynamically. */
  private async sniffMime(buffer: Buffer): Promise<string | null> {
    const { fileTypeFromBuffer } = await import('file-type');
    const type = await fileTypeFromBuffer(buffer);
    return type?.mime ?? null;
  }

  private async storeImage(
    buffer: Buffer,
    opts: { kind: MediaKind; ownerId: string; mime: string },
  ): Promise<UploadMediaResponse> {
    const sharp = (await import('sharp')).default;
    // autoOrient applies the EXIF orientation; the constructor-level
    // limitInputPixels refuses decompression bombs before decoding starts;
    // metadata is stripped by default (no withMetadata call anywhere).
    const image = sharp(buffer, {
      autoOrient: true,
      limitInputPixels: this.config.maxImagePixels,
    });
    let main: { data: Buffer; info: OutputInfo };
    try {
      main = await image
        .resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: MAIN_WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
    } catch (err) {
      // Corrupt images and bombs surface here as input errors.
      this.logger.warn(`image decode failed: ${(err as Error).message}`);
      throw new MediaError('UNPROCESSABLE', 'Corrupt or unsupported image');
    }

    const thumb = await sharp(main.data)
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const base = this.dateBase();
    const id = randomUUID();
    const key = `${opts.kind}/${base}/${id}.webp`;
    const thumbKey = `${opts.kind}/${base}/${id}_t.webp`;
    const stored = await this.storage.put(key, main.data, { contentType: PROCESSED_IMAGE_MIME });
    await this.storage.put(thumbKey, thumb.data, { contentType: PROCESSED_IMAGE_MIME });

    const row = await this.repo.insert({
      ownerUserId: opts.ownerId,
      kind: opts.kind,
      key,
      thumbKey,
      mime: PROCESSED_IMAGE_MIME,
      sizeBytes: stored.size,
      width: main.info.width,
      height: main.info.height,
    });
    return this.toResponse(row);
  }

  /** Document kinds: raw bytes stored untouched, never served inline. */
  private async storeRaw(
    buffer: Buffer,
    opts: { kind: MediaKind; ownerId: string; mime: string; ext: string },
  ): Promise<UploadMediaResponse> {
    const base = this.dateBase();
    const id = randomUUID();
    const key = `${opts.kind}/${base}/${id}.${opts.ext}`;
    const stored = await this.storage.put(key, buffer, { contentType: opts.mime });
    const row = await this.repo.insert({
      ownerUserId: opts.ownerId,
      kind: opts.kind,
      key,
      thumbKey: null,
      mime: opts.mime,
      sizeBytes: stored.size,
      width: null,
      height: null,
    });
    return this.toResponse(row);
  }

  /** `<yyyy>/<mm>` path segment (UTC — deterministic, tz-independent keys). */
  private dateBase(): string {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}/${mm}`;
  }

  private toResponse(row: MediaFileRow): UploadMediaResponse {
    const base = this.config.mediaPublicBase.replace(/\/+$/, '');
    return {
      id: row.id,
      kind: row.kind,
      url: `${base}/${row.key}`,
      thumbUrl: row.thumbKey ? `${base}/${row.thumbKey}` : null,
      mime: row.mime as UploadMediaResponse['mime'],
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
    };
  }

  /**
   * Mark an upload as attached to an entity (idempotent). Only the owner may
   * attach their file; admins manage media through moderation flows later.
   */
  async markAttached(mediaId: string, ownerId: string): Promise<MediaFileRow> {
    const row = await this.repo.findById(mediaId);
    if (!row || row.deletedAt) throw this.notFound();
    if (row.ownerUserId !== ownerId) {
      throw new HttpException('Not your media', HttpStatus.FORBIDDEN);
    }
    return (await this.repo.markAttached(mediaId)) ?? row;
  }

  /**
   * Owner (or admin) soft-deletes their file; physical removal is queued so
   * the request path stays fast and a crashed removal is retried.
   */
  async deleteOwned(mediaId: string, user: { id: string; role: string }): Promise<void> {
    const row = await this.repo.findById(mediaId);
    if (!row || row.deletedAt) throw this.notFound();
    const isAdmin = user.role === 'admin' || user.role === 'super_admin';
    if (row.ownerUserId !== user.id && !isAdmin) {
      throw new HttpException('Not your media', HttpStatus.FORBIDDEN);
    }
    await this.repo.softDelete(mediaId);
    const keys = [row.key, row.thumbKey].filter((k): k is string => Boolean(k));
    await this.queues.enqueue(MEDIA_QUEUE, 'delete', { keys } satisfies DeleteMediaJobData);
  }

  /**
   * Remove uploads that were never attached within ORPHAN_AFTER_MS — both
   * the stored files and the rows. Called hourly from the worker (B1.9).
   */
  async cleanupOrphans(now = new Date(), limit = 200): Promise<number> {
    const cutoff = new Date(now.getTime() - ORPHAN_AFTER_MS);
    const orphans = await this.repo.findUnattachedOlderThan(cutoff, limit);
    let removed = 0;
    for (const row of orphans) {
      for (const key of [row.key, row.thumbKey]) {
        if (key) await this.storage.delete(key).catch(() => undefined);
      }
      await this.repo.deleteRow(row.id);
      removed += 1;
    }
    return removed;
  }

  /** Delete stored files for a key list (worker-side job body). */
  async deleteFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.delete(key).catch((err: Error) => {
        this.logger.warn(`failed to delete ${key}: ${err.message}`);
      });
    }
  }

  /** Public kinds only — the serving controller re-checks independently. */
  isPubliclyServable(kind: MediaKind): boolean {
    return isPublicMediaKind(kind);
  }

  private notFound(): HttpException {
    return new HttpException('Not found', HttpStatus.NOT_FOUND);
  }
}
