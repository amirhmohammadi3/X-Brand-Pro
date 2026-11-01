import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import type { MediaFileRow } from '../src/db/schema/media.js';
import type { AppConfig } from '../src/config/env.js';
import { buildAppConfig, loadEnv } from '../src/config/env.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';
import { MediaError, MediaService } from '../src/modules/media/media.service.js';
import { DiskStorageDriver } from '../src/modules/storage/drivers/disk.driver.js';
import type { QueuesService } from '../src/queue/queues.service.js';

/**
 * MediaService unit tests (B1.9) with the REAL sharp pipeline and the REAL
 * disk driver on a tmp dir: EXIF handling, re-encoding, thumbnails, magic-byte
 * sniffing rejections, decompression bombs, per-kind size caps, ownership and
 * orphan cleanup. No Postgres/Redis needed — the repository is a memory fake.
 */

/** In-memory MediaRepositoryLike over a Map (created rows carry real dates). */
function makeMemoryMediaRepo() {
  const rows = new Map<string, MediaFileRow>();
  let seq = 0;
  const repo: MediaRepositoryLike & { rows: Map<string, MediaFileRow> } = {
    rows,
    async insert(row) {
      const created: MediaFileRow = {
        id: row.id ?? `m-${++seq}`,
        ownerUserId: row.ownerUserId,
        kind: row.kind,
        key: row.key,
        thumbKey: row.thumbKey,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        attachedAt: null,
        createdAt: new Date(),
        deletedAt: null,
      };
      rows.set(created.id, created);
      return created;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByKey(key) {
      return [...rows.values()].find((r) => r.key === key) ?? null;
    },
    async markAttached(id) {
      const row = rows.get(id);
      if (!row || row.attachedAt) return row ?? null;
      row.attachedAt = new Date();
      return row;
    },
    async softDelete(id) {
      const row = rows.get(id);
      if (!row || row.deletedAt) return null;
      row.deletedAt = new Date();
      return row;
    },
    async findUnattachedOlderThan(olderThan, limit) {
      return [...rows.values()]
        .filter((r) => !r.attachedAt && !r.deletedAt && r.createdAt.getTime() < olderThan.getTime())
        .slice(0, limit);
    },
    async deleteRow(id) {
      rows.delete(id);
    },
    async findSoftDeletedBefore() {
      return [...rows.values()].filter((r) => r.deletedAt);
    },
  };
  return repo;
}

/** sharp fixture helpers. */
async function jpeg(w: number, h: number, opts: { orientation?: number; exif?: boolean } = {}) {
  const sharp = (await import('sharp')).default;
  let img = sharp({
    create: { width: w, height: h, channels: 3, background: { r: 200, g: 10, b: 10 } },
  });
  if (opts.exif) img = img.withExif({ IFD0: { ImageDescription: 'private-gps-data' } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.jpeg().toBuffer();
}

async function pngWithAlpha(w: number, h: number) {
  const sharp = (await import('sharp')).default;
  // 4 channels = RGBA: every 4th byte semi-transparent.
  const input = Buffer.alloc(w * h * 4);
  for (let i = 0; i < input.length; i += 4) input[i + 3] = 128;
  return sharp(input, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

/** Minimal PNG whose IHDR declares a 60000x60000 canvas (3.6G pixels). */
function bombPng(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(60000, 0);
  ihdrData.writeUInt32BE(60000, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type truecolor
  const type = Buffer.from('IHDR');
  const crc = crc32(Buffer.concat([type, ihdrData])) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  return Buffer.concat([signature, len, type, ihdrData, crcBuf]);
}

/** Asserts a rejection is a MediaError with the given code and HTTP status. */
async function expectMediaError(p: Promise<unknown>, code: string, status: number): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  if (!caught) throw new Error('expected the call to be rejected');
  expect(caught).toBeInstanceOf(MediaError);
  expect((caught as MediaError).code).toBe(code);
  expect((caught as MediaError).getStatus()).toBe(status);
}

/** Asserts a rejection carries the given HTTP status (plain HttpException). */
async function expectStatus(p: Promise<unknown>, status: number): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  if (!caught) throw new Error('expected the call to be rejected');
  expect((caught as { getStatus?: () => number }).getStatus?.()).toBe(status);
}

/** Collects a whole driver stream into a Buffer (sharp prefers buffers). */
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('MediaService', () => {
  let root: string;
  let driver: DiskStorageDriver;
  let repo: ReturnType<typeof makeMemoryMediaRepo>;
  let service: MediaService;
  let enqueue: ReturnType<typeof vi.fn>;

  const OWNER = 'user-1';

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'xbrand-media-'));
    driver = new DiskStorageDriver(root);
    repo = makeMemoryMediaRepo();
    enqueue = vi.fn(async () => 'job-1');
    const config: AppConfig = buildAppConfig(
      loadEnv({ ...process.env, STORAGE_ROOT: root, MEDIA_PUBLIC_BASE: '/media' }),
    );
    service = new MediaService(repo, driver, { enqueue } as unknown as QueuesService, config);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('re-encodes a JPEG to WebP, strips metadata and returns urls', async () => {
    const input = await jpeg(100, 60, { exif: true });
    const out = await service.saveImage(
      { buffer: input, originalName: 'photo.jpg', size: input.length },
      { kind: 'avatar', ownerId: OWNER },
    );
    expect(out.kind).toBe('avatar');
    expect(out.mime).toBe('image/webp');
    expect(out.url).toMatch(/^\/media\/avatar\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    expect(out.thumbUrl).toMatch(/_t\.webp$/);
    expect(out.width).toBe(100);
    expect(out.height).toBe(60);

    const key = out.url.replace('/media/', '');
    const stored = await driver.getStream(key);
    const sharp = (await import('sharp')).default;
    const meta = await sharp(await readAll(stored.stream)).metadata();
    expect(meta.format).toBe('webp');
    // EXIF (including the fake GPS description) is stripped by default.
    expect(meta.exif).toBeUndefined();
    const metaRecord = meta as unknown as Record<string, unknown>;
    expect(metaRecord.imageDescription ?? metaRecord.ImageDescription).toBeUndefined();
    const thumbMeta = await sharp(
      await readAll((await driver.getStream(out.thumbUrl!.replace('/media/', ''))).stream),
    ).metadata();
    expect(thumbMeta.format).toBe('webp');
  });

  it('applies EXIF orientation (rotated camera photos come out upright)', async () => {
    // 20x40 pixels + orientation 6 (= rotate 90° CW for display).
    const input = await jpeg(20, 40, { orientation: 6, exif: true });
    const out = await service.saveImage(
      { buffer: input, originalName: 'phone.jpg', size: input.length },
      { kind: 'review_photo', ownerId: OWNER },
    );
    expect(out.width).toBe(40); // swapped
    expect(out.height).toBe(20);
  });

  it('keeps transparency when re-encoding PNG with alpha to WebP', async () => {
    const input = await pngWithAlpha(30, 30);
    const out = await service.saveImage(
      { buffer: input, originalName: 'logo.png', size: input.length },
      { kind: 'menu_photo', ownerId: OWNER },
    );
    const sharp = (await import('sharp')).default;
    const meta = await sharp(
      await readAll((await driver.getStream(out.url.replace('/media/', ''))).stream),
    ).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.hasAlpha).toBe(true);
  });

  it('caps the long edge at 2560 without enlarging small images', async () => {
    const big = await jpeg(2600, 1200);
    const outBig = await service.saveImage(
      { buffer: big, originalName: 'big.jpg', size: big.length },
      { kind: 'business_photo', ownerId: OWNER },
    );
    expect(outBig.width).toBe(2560);
    expect(outBig.height).toBeLessThanOrEqual(1200);

    const small = await jpeg(800, 400);
    const outSmall = await service.saveImage(
      { buffer: small, originalName: 'small.jpg', size: small.length },
      { kind: 'review_photo', ownerId: OWNER },
    );
    expect(outSmall.width).toBe(800); // untouched
    expect(outSmall.height).toBe(400);

    // Thumbnail is 400 px on the long edge.
    expect(outSmall.thumbUrl).toBeTruthy();
    const sharp = (await import('sharp')).default;
    const thumb = await sharp(
      await readAll((await driver.getStream(outSmall.thumbUrl!.replace('/media/', ''))).stream),
    ).metadata();
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBe(400);
    expect(Math.min(thumb.width ?? 0, thumb.height ?? 0)).toBe(200);
  });

  it('rejects a text file renamed to .jpg (magic bytes do not lie)', async () => {
    const fake = Buffer.from('this is definitely not an image, just text');
    await expectMediaError(
      service.saveImage(
        { buffer: fake, originalName: 'photo.jpg', size: fake.length },
        { kind: 'avatar', ownerId: OWNER },
      ),
      'UNPROCESSABLE',
      422,
    );
  });

  it('rejects SVG payloads (never detected, never executable)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expectMediaError(
      service.saveImage(
        { buffer: svg, originalName: 'evil.svg', size: svg.length },
        { kind: 'avatar', ownerId: OWNER },
      ),
      'UNPROCESSABLE',
      422,
    );
  });

  it('rejects GIF (valid magic bytes, unsupported type)', async () => {
    const gif = Buffer.concat([
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
      Buffer.alloc(20),
    ]);
    await expectMediaError(
      service.saveImage(
        { buffer: gif, originalName: 'anim.gif', size: gif.length },
        { kind: 'avatar', ownerId: OWNER },
      ),
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    );
  });

  it('rejects a decompression bomb declaring 3.6G pixels', async () => {
    const bomb = bombPng();
    await expectMediaError(
      service.saveImage(
        { buffer: bomb, originalName: 'bomb.png', size: bomb.length },
        { kind: 'review_photo', ownerId: OWNER },
      ),
      'UNPROCESSABLE',
      422,
    );
  });

  it('enforces the per-kind size cap before decoding', async () => {
    const big = await jpeg(600, 600);
    // Pad the JPEG with trailing garbage so it exceeds the 2 MB avatar cap.
    const padded = Buffer.concat([big, Buffer.alloc(3 * 1024 * 1024)]);
    await expectMediaError(
      service.saveImage(
        { buffer: padded, originalName: 'big-avatar.jpg', size: padded.length },
        { kind: 'avatar', ownerId: OWNER },
      ),
      'PAYLOAD_TOO_LARGE',
      413,
    );
  });

  it('stores PDFs untouched for document kinds only', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%fake-pdf-bytes\n%%EOF\n');
    await expectMediaError(
      service.saveImage(
        { buffer: pdf, originalName: 'doc.pdf', size: pdf.length },
        { kind: 'avatar', ownerId: OWNER },
      ),
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    );

    const out = await service.saveImage(
      { buffer: pdf, originalName: 'doc.pdf', size: pdf.length },
      { kind: 'claim_document', ownerId: OWNER },
    );
    expect(out.mime).toBe('application/pdf');
    expect(out.thumbUrl).toBeNull();
    expect(out.width).toBeNull();
    expect(out.height).toBeNull();
    expect(out.url).toMatch(/^\/media\/claim_document\/\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
    // Stored bytes are identical (untouched).
    const stored = await driver.getStream(out.url.replace('/media/', ''));
    const chunks: Buffer[] = [];
    for await (const c of stored.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks)).toEqual(pdf);
  });

  describe('markAttached', () => {
    it('attaches for the owner, idempotently', async () => {
      const input = await jpeg(10, 10);
      const out = await service.saveImage(
        { buffer: input, originalName: 'a.jpg', size: input.length },
        { kind: 'avatar', ownerId: OWNER },
      );
      const first = await service.markAttached(out.id, OWNER);
      expect(first.attachedAt).toBeInstanceOf(Date);
      const again = await service.markAttached(out.id, OWNER);
      expect(again.attachedAt).toEqual(first.attachedAt);
    });

    it("refuses another user's file", async () => {
      const input = await jpeg(10, 10);
      const out = await service.saveImage(
        { buffer: input, originalName: 'b.jpg', size: input.length },
        { kind: 'avatar', ownerId: OWNER },
      );
      await expectStatus(service.markAttached(out.id, 'someone-else'), 403);
    });
  });

  describe('deleteOwned', () => {
    it('soft-deletes the row and queues file removal', async () => {
      const input = await jpeg(10, 10);
      const out = await service.saveImage(
        { buffer: input, originalName: 'c.jpg', size: input.length },
        { kind: 'avatar', ownerId: OWNER },
      );
      enqueue.mockClear();
      await service.deleteOwned(out.id, { id: OWNER, role: 'user' });
      expect(repo.rows.get(out.id)?.deletedAt).toBeInstanceOf(Date);
      expect(enqueue).toHaveBeenCalledTimes(1);
      const [queue, name, data] = enqueue.mock.calls[0] as [string, string, { keys: string[] }];
      expect(queue).toBe('media');
      expect(name).toBe('delete');
      expect(data.keys).toContain(out.url.replace('/media/', ''));
      expect(data.keys.length).toBe(2); // main + thumb
    });

    it('refuses a non-owner non-admin, allows admins', async () => {
      const input = await jpeg(10, 10);
      const out = await service.saveImage(
        { buffer: input, originalName: 'd.jpg', size: input.length },
        { kind: 'avatar', ownerId: OWNER },
      );
      await expectStatus(service.deleteOwned(out.id, { id: 'random-user', role: 'user' }), 403);
      await service.deleteOwned(out.id, { id: 'admin-user', role: 'admin' });
      expect(repo.rows.get(out.id)?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('cleanupOrphans', () => {
    it('removes only old unattached uploads (files and rows)', async () => {
      const input = await jpeg(10, 10);
      const old = await service.saveImage(
        { buffer: input, originalName: 'old.jpg', size: input.length },
        { kind: 'review_photo', ownerId: OWNER },
      );
      const fresh = await service.saveImage(
        { buffer: input, originalName: 'fresh.jpg', size: input.length },
        { kind: 'review_photo', ownerId: OWNER },
      );
      const attached = await service.saveImage(
        { buffer: input, originalName: 'att.jpg', size: input.length },
        { kind: 'review_photo', ownerId: OWNER },
      );
      await service.markAttached(attached.id, OWNER);

      // Age only the first row beyond the 24h window.
      const oldRow = repo.rows.get(old.id);
      expect(oldRow).toBeTruthy();
      oldRow!.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

      const removed = await service.cleanupOrphans(new Date());
      expect(removed).toBe(1);
      expect(repo.rows.has(old.id)).toBe(false);
      expect(repo.rows.has(fresh.id)).toBe(true);
      expect(repo.rows.has(attached.id)).toBe(true);
      // The stored files are gone for the removed row.
      expect(await driver.exists(old.url.replace('/media/', ''))).toBe(false);
      expect(await driver.exists(fresh.url.replace('/media/', ''))).toBe(true);
    });
  });
});
