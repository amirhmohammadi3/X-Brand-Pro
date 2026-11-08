import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { MediaFileRow } from '../src/db/schema/media.js';
import type { BusinessPhotoWithMedia } from '../src/modules/business/photos/business-photos.repository.js';
import { PhotosService } from '../src/modules/business/photos/photos.service.js';
import type { BusinessPhotosRepositoryLike } from '../src/modules/business/photos/business-photos.repository.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';
import type { MediaService } from '../src/modules/media/media.service.js';
import type { MediaUrlService } from '../src/modules/media/media-url.service.js';

/**
 * PhotosService unit tests (B2.7) — the gallery orchestration exercised
 * without a database via hand-written fakes. Covers the attach flow (media
 * validation, ownership, cap, idempotent retry, markAttached rollback), the
 * full-permutation reorder rule, delete clearing the cover and soft-deleting
 * the media, and the cover must-be-in-gallery rule. HTTP-layer authorization
 * (assertCanManageBusiness / visibility) is shared with B2.5/B2.6 and covered
 * there; the controller re-uses the same helpers.
 */

const BIZ = randomUUID();
const OTHER_BIZ = randomUUID();
const USER = { id: randomUUID(), role: 'user' };
const MEDIA_ID = randomUUID();

function mediaRow(overrides: Partial<MediaFileRow> = {}): MediaFileRow {
  return {
    id: MEDIA_ID,
    ownerUserId: USER.id,
    kind: 'business_photo',
    key: 'business_photo/2026/11/x.webp',
    thumbKey: 'business_photo/2026/11/x_t.webp',
    mime: 'image/webp',
    sizeBytes: 1234,
    width: 800,
    height: 600,
    attachedAt: null,
    createdAt: new Date('2026-11-09T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function photoRow(overrides: Partial<BusinessPhotoWithMedia> = {}): BusinessPhotoWithMedia {
  return {
    id: randomUUID(),
    businessId: BIZ,
    mediaId: MEDIA_ID,
    sortOrder: 0,
    createdAt: new Date('2026-11-09T00:00:00Z'),
    key: 'business_photo/2026/11/x.webp',
    thumbKey: 'business_photo/2026/11/x_t.webp',
    width: 800,
    height: 600,
    ...overrides,
  };
}

/** In-memory fake of the photos repository surface. */
function makePhotosFake(opts: { rows?: BusinessPhotoWithMedia[]; cover?: string | null } = {}) {
  const rows = new Map<string, BusinessPhotoWithMedia>();
  for (const r of opts.rows ?? []) rows.set(r.id, r);
  let cover: string | null = opts.cover ?? null;
  const fake: BusinessPhotosRepositoryLike = {
    findBusinessContext: vi.fn(async (id: string) =>
      id === BIZ ? { ownerId: USER.id, status: 'pending', deletedAt: null } : null,
    ),
    listByBusiness: vi.fn(async () => [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder)),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    findByMediaId: vi.fn(
      async (mediaId: string) => [...rows.values()].find((r) => r.mediaId === mediaId) ?? null,
    ),
    countByBusiness: vi.fn(async () => rows.size),
    maxSortOrder: vi.fn(async () =>
      rows.size === 0 ? -1 : Math.max(...[...rows.values()].map((r) => r.sortOrder)),
    ),
    insert: vi.fn(async (businessId: string, mediaId: string, sortOrder: number) => {
      const row = photoRow({ businessId, mediaId, sortOrder });
      rows.set(row.id, row);
      return row;
    }),
    reorder: vi.fn(async (_businessId: string, orderedIds: string[]) => {
      for (const [i, id] of orderedIds.entries()) {
        const row = rows.get(id);
        if (row) row.sortOrder = i;
      }
    }),
    delete: vi.fn(async (id: string) => {
      rows.delete(id);
    }),
    findCoverMediaId: vi.fn(async () => cover),
    setCover: vi.fn(async (_businessId: string, mediaId: string) => {
      cover = mediaId;
    }),
    clearCoverIfSet: vi.fn(async (_businessId: string, mediaId: string) => {
      if (cover === mediaId) cover = null;
    }),
  };
  return { fake, rows, coverRef: () => cover };
}

/** Media rows fake + MediaService/MediaUrlService test doubles. */
function makeMediaFake(opts: { media?: MediaFileRow | null; failAttach?: Error } = {}) {
  const media: MediaFileRow | null = opts.media !== undefined ? opts.media : mediaRow();
  const repo: MediaRepositoryLike = {
    insert: vi.fn(),
    findById: vi.fn(async () => media),
    findByKey: vi.fn(async () => null),
    markAttached: vi.fn(async (id: string) => {
      if (media && media.id === id) media.attachedAt = new Date();
      return media;
    }),
    softDelete: vi.fn(async () => media),
    findUnattachedOlderThan: vi.fn(async () => []),
    deleteRow: vi.fn(),
    findSoftDeletedBefore: vi.fn(async () => []),
  } as unknown as MediaRepositoryLike;
  const service = {
    markAttached: vi.fn(async (id: string, ownerId: string) => {
      if (opts.failAttach) throw opts.failAttach;
      if (!media || media.id !== id) throw new NotFoundException('Media not found');
      if (media.ownerUserId !== ownerId) throw new ForbiddenException('Not your media');
      media.attachedAt = media.attachedAt ?? new Date();
      return media;
    }),
    deleteOwned: vi.fn(async () => undefined),
  } as unknown as MediaService;
  const urls = {
    urlFor: (key: string | null | undefined) => (key ? `https://media.test/${key}` : null),
  } as unknown as MediaUrlService;
  return { repo, service, urls, mediaRef: () => media };
}

function makeService(opts?: {
  rows?: BusinessPhotoWithMedia[];
  cover?: string | null;
  media?: MediaFileRow | null;
  failAttach?: Error;
}) {
  const photos = makePhotosFake(opts);
  const media = makeMediaFake(opts);
  const svc = new PhotosService(photos.fake, media.repo, media.service, media.urls);
  return { svc, photos, media };
}

describe('PhotosService.attach (B2.7)', () => {
  it('attaches a fresh business_photo upload at max+1 and marks it attached', async () => {
    const { svc, photos, media } = makeService();
    const p = await svc.attach(BIZ, USER, MEDIA_ID);
    expect(p.mediaId).toBe(MEDIA_ID);
    expect(p.sortOrder).toBe(0);
    expect(p.url).toBe('https://media.test/business_photo/2026/11/x.webp');
    expect(p.thumbUrl).toBe('https://media.test/business_photo/2026/11/x_t.webp');
    expect(photos.fake.maxSortOrder).toHaveBeenCalledWith(BIZ);
    expect(media.service.markAttached).toHaveBeenCalledWith(MEDIA_ID, USER.id);
    expect(media.mediaRef()?.attachedAt).not.toBeNull();
  });

  it('rolls the gallery row back when markAttached rejects (no partial state)', async () => {
    const { svc, photos } = makeService({
      failAttach: new Error('storage failure during attach'),
    });
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toThrow('storage failure');
    expect(photos.rows.size).toBe(0);
  });

  it('409s when the media is already attached to another business', async () => {
    const { svc } = makeService({
      rows: [photoRow({ businessId: OTHER_BIZ })],
      media: mediaRow({ attachedAt: new Date() }),
    });
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('retries idempotently when the row exists for the same business', async () => {
    const existing = photoRow({ mediaId: MEDIA_ID });
    const { svc, media } = makeService({
      rows: [existing],
      media: mediaRow({ attachedAt: new Date() }),
    });
    const p = await svc.attach(BIZ, USER, MEDIA_ID);
    expect(p.id).toBe(existing.id);
    expect(media.service.markAttached).toHaveBeenCalledTimes(1);
  });

  it('404s for a deleted or unknown media id', async () => {
    const { svc } = makeService({ media: mediaRow({ deletedAt: new Date() }) });
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s when the media kind is not business_photo', async () => {
    const { svc } = makeService({ media: mediaRow({ kind: 'avatar' }) });
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toMatchObject({
      status: 422,
    });
  });

  it('403s when the caller is not the uploader', async () => {
    const { svc } = makeService({ media: mediaRow({ ownerUserId: randomUUID() }) });
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toMatchObject({ status: 403 });
  });

  it('409s when the media is attached to a non-gallery flow', async () => {
    const { svc } = makeService({ media: mediaRow({ attachedAt: new Date() }) });
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('422s at BUSINESS_MAX_PHOTOS', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      photoRow({ id: randomUUID(), mediaId: randomUUID(), sortOrder: i }),
    );
    const { svc, photos } = makeService({ rows });
    expect(photos.rows.size).toBe(10);
    await expect(svc.attach(BIZ, USER, MEDIA_ID)).rejects.toMatchObject({ status: 422 });
  });
});

describe('PhotosService.reorder (B2.7)', () => {
  const a = photoRow({ id: randomUUID(), sortOrder: 0 });
  const b = photoRow({ id: randomUUID(), sortOrder: 1 });

  it('permutes the order and returns the gallery in the new sequence', async () => {
    const { svc } = makeService({ rows: [a, b] });
    const items = await svc.reorder(BIZ, [b.id, a.id]);
    expect(items.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(items.map((p) => p.sortOrder)).toEqual([0, 1]);
  });

  it('404s an unknown photo id', async () => {
    const { svc } = makeService({ rows: [a] });
    await expect(svc.reorder(BIZ, [randomUUID()])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s a duplicate id', async () => {
    const { svc } = makeService({ rows: [a, b] });
    await expect(svc.reorder(BIZ, [a.id, a.id])).rejects.toMatchObject({ status: 422 });
  });

  it('422s an incomplete list (stale client cannot silently drop photos)', async () => {
    const { svc } = makeService({ rows: [a, b] });
    await expect(svc.reorder(BIZ, [a.id])).rejects.toMatchObject({ status: 422 });
  });
});

describe('PhotosService.remove (B2.7)', () => {
  it('deletes the row, clears the cover pointing at it, soft-deletes the media', async () => {
    const { svc, photos, media } = makeService({
      rows: [photoRow()],
      cover: MEDIA_ID,
    });
    const photo = [...photos.rows.values()][0];
    if (!photo) throw new Error('fixture missing');
    await svc.remove(BIZ, photo.id, USER);
    expect(photos.rows.size).toBe(0);
    expect(photos.coverRef()).toBeNull();
    expect(media.service.deleteOwned).toHaveBeenCalledWith(MEDIA_ID, {
      id: USER.id,
      role: USER.role,
    });
  });

  it('leaves the cover alone when another photo is the cover', async () => {
    const coverMedia = randomUUID();
    const { svc, photos } = makeService({ rows: [photoRow()], cover: coverMedia });
    const photo = [...photos.rows.values()][0];
    if (!photo) throw new Error('fixture missing');
    await svc.remove(BIZ, photo.id, USER);
    expect(photos.coverRef()).toBe(coverMedia);
  });

  it('404s a photo from another business', async () => {
    const foreign = photoRow({ businessId: OTHER_BIZ });
    const { svc } = makeService({ rows: [foreign] });
    await expect(svc.remove(BIZ, foreign.id, USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PhotosService.setCover (B2.7)', () => {
  it('sets the cover to a gallery media id', async () => {
    const { svc, photos } = makeService({ rows: [photoRow()] });
    await svc.setCover(BIZ, MEDIA_ID);
    expect(photos.coverRef()).toBe(MEDIA_ID);
  });

  it('404s a media id that is not in this business gallery', async () => {
    const { svc } = makeService({
      rows: [photoRow({ businessId: OTHER_BIZ, mediaId: MEDIA_ID })],
    });
    await expect(svc.setCover(BIZ, MEDIA_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PhotosService.getBusinessContext (B2.7)', () => {
  it('404s a missing business (never leaks existence)', async () => {
    const { svc } = makeService();
    await expect(svc.getBusinessContext(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns ownerId + status for a live business', async () => {
    const { svc } = makeService();
    const ctx = await svc.getBusinessContext(BIZ);
    expect(ctx).toEqual({ ownerId: USER.id, status: 'pending' });
  });
});
