import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { MEDIA_REPOSITORY } from '../src/modules/media/media.repository.js';
import { STORAGE_DRIVER } from '../src/modules/storage/storage.driver.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { DiskStorageDriver } from '../src/modules/storage/drivers/disk.driver.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';

/**
 * HTTP-level media tests (B1.9) WITHOUT live services: Redis is FakeRedis,
 * the user/session/media repositories are in-memory fakes, storage is the
 * real DiskStorageDriver on a tmp dir. This runs the REAL controllers,
 * guards (RateLimit → JwtAuth → CsrfOrigin → Roles), multer, the envelope,
 * the exception filter and the /media/* serving route (global-prefix
 * exclude). A live-DB run happens on Docker machines (PROGRESS Follow-ups).
 */
let app: INestApplication;
let redis: FakeRedis;
let mediaRepo: MediaRepositoryLike & { rows: Map<string, unknown> };
let storageRoot: string;
let enqueue: ReturnType<typeof vi.fn>;
let user: LoginSession; // plain user
let ownerSession: LoginSession; // owner role

/** In-memory MediaRepositoryLike (mirrors media.service.spec fake). */
function makeMemoryMediaRepo() {
  const rows = new Map<string, Record<string, unknown>>();
  const repo = {
    rows,
    async insert(row: Record<string, unknown>) {
      const id = randomUUID();
      const created = {
        id,
        attachedAt: null,
        createdAt: new Date(),
        deletedAt: null,
        ...row,
      };
      rows.set(id, created);
      return created;
    },
    async findById(id: string) {
      return rows.get(id) ?? null;
    },
    async findByKey(key: string) {
      return [...rows.values()].find((r) => r.key === key) ?? null;
    },
    async markAttached(id: string) {
      const row = rows.get(id) as { attachedAt: Date | null } | undefined;
      if (!row || row.attachedAt) return row ?? null;
      row.attachedAt = new Date();
      return row;
    },
    async softDelete(id: string) {
      const row = rows.get(id) as { deletedAt: Date | null } | undefined;
      if (!row || row.deletedAt) return null;
      row.deletedAt = new Date();
      return row;
    },
    async findUnattachedOlderThan() {
      return [];
    },
    async deleteRow(id: string) {
      rows.delete(id);
    },
    async findSoftDeletedBefore() {
      return [];
    },
  };
  return repo as unknown as MediaRepositoryLike & { rows: Map<string, unknown> };
}

async function jpegBuffer(w = 24, h = 16): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  redis = new FakeRedis();
  mediaRepo = makeMemoryMediaRepo();
  storageRoot = await mkdtemp(path.join(tmpdir(), 'xbrand-media-api-'));
  enqueue = vi.fn(async () => 'job-1');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(MEDIA_REPOSITORY)
    .useValue(mediaRepo)
    .overrideProvider(STORAGE_DRIVER)
    .useValue(new DiskStorageDriver(storageRoot))
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ enqueue })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  // createUser hashes through the real PasswordService via UsersService.
  await createUser(app, { username: 'mediauser', password: 'Sup3rSecret!2026' });
  await createUser(app, { username: 'mediaowner', password: 'Sup3rSecret!2026', role: 'owner' });
  user = await loginAs(app, 'mediauser', 'Sup3rSecret!2026');
  ownerSession = await loginAs(app, 'mediaowner', 'Sup3rSecret!2026');
});

afterAll(async () => {
  await app?.close();
  await rm(storageRoot, { recursive: true, force: true });
});

const upload = (bearer?: string) =>
  request(app.getHttpServer())
    .post('/api/v1/media/upload')
    .set(bearer ? { Authorization: bearer } : {});

describe('POST /api/v1/media/upload', () => {
  it('401 without authentication', async () => {
    const res = await upload().field('kind', 'avatar').attach('file', Buffer.from('x'), 'x.jpg');
    expect(res.status).toBe(401);
  });

  it('validates kind against the contracts enum', async () => {
    const res = await upload(user.bearer)
      .field('kind', 'hacker_kind')
      .attach('file', Buffer.from('x'), 'x.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('uploads a real image and returns the envelope with urls', async () => {
    const res = await upload(user.bearer)
      .field('kind', 'avatar')
      .attach('file', await jpegBuffer(), 'photo.jpg');
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(data.mime).toBe('image/webp');
    expect(data.url).toMatch(/^\/media\/avatar\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    expect(data.thumbUrl).toContain('_t.webp');
    expect(data.width).toBe(24);
    expect(data.height).toBe(16);
  });

  it('422 for a text file renamed .jpg', async () => {
    const res = await upload(user.bearer)
      .field('kind', 'avatar')
      .attach('file', Buffer.from('plain text, not an image at all'), 'photo.jpg');
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('UNPROCESSABLE');
  });

  it('415 for a GIF (valid magic bytes, unsupported type)', async () => {
    const gif = Buffer.concat([
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      Buffer.alloc(24),
    ]);
    const res = await upload(user.bearer).field('kind', 'avatar').attach('file', gif, 'a.gif');
    expect(res.status).toBe(415);
    expect(res.body.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('413 for a file above the per-kind cap', async () => {
    const big = Buffer.concat([await jpegBuffer(64, 64), Buffer.alloc(3 * 1024 * 1024)]);
    const res = await upload(user.bearer).field('kind', 'avatar').attach('file', big, 'big.jpg');
    expect(res.status).toBe(413);
    expect(res.body.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('403 for business_photo with a plain user, 201 for an owner', async () => {
    const denied = await upload(user.bearer)
      .field('kind', 'business_photo')
      .attach('file', await jpegBuffer(), 'shop.jpg');
    expect(denied.status).toBe(403);

    const allowed = await upload(ownerSession.bearer)
      .field('kind', 'business_photo')
      .attach('file', await jpegBuffer(), 'shop.jpg');
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.kind).toBe('business_photo');
  });
});

describe('GET /media/<key> (public serving)', () => {
  let url: string;

  beforeAll(async () => {
    const res = await upload(user.bearer)
      .field('kind', 'review_photo')
      .attach('file', await jpegBuffer(40, 30), 'review.jpg');
    url = res.body.data.url as string;
  });

  it('serves the stored webp with immutable caching headers', async () => {
    const res = await request(app.getHttpServer()).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('supports Range requests (206 + Content-Range) and 416 for bad ranges', async () => {
    const partial = await request(app.getHttpServer()).get(url).set('Range', 'bytes=0-9');
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toMatch(/^bytes 0-9\/\d+$/);
    expect(partial.body.length).toBe(10);

    const suffix = await request(app.getHttpServer()).get(url).set('Range', 'bytes=-5');
    expect(suffix.status).toBe(206);

    const invalid = await request(app.getHttpServer()).get(url).set('Range', 'bytes=999999-');
    expect(invalid.status).toBe(416);
    expect(invalid.headers['content-range']).toMatch(/^bytes \*\/\d+$/);
  });

  it('404s for unknown keys and traversal attempts', async () => {
    expect((await request(app.getHttpServer()).get('/media/avatar/2026/11/nope.webp')).status).toBe(
      404,
    );
    expect((await request(app.getHttpServer()).get('/media/avatar/../../.env')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/media/')).status).toBe(404);
  });

  it('404s for PRIVATE kinds (claim documents are never publicly served)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%test\n%%EOF\n');
    const res = await upload(user.bearer)
      .field('kind', 'claim_document')
      .attach('file', pdf, 'deed.pdf');
    expect(res.status).toBe(201);
    expect(res.body.data.mime).toBe('application/pdf');
    expect(res.body.data.thumbUrl).toBeNull();
    const served = await request(app.getHttpServer()).get(res.body.data.url as string);
    expect(served.status).toBe(404);
  });
});

describe('DELETE /api/v1/media/:id', () => {
  it('401 without authentication, 404 unknown id', async () => {
    expect((await request(app.getHttpServer()).delete('/api/v1/media/m-999')).status).toBe(401);
    const res = await request(app.getHttpServer())
      .delete('/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      .set('Authorization', user.bearer);
    expect(res.status).toBe(404);
  });

  it('owner deletes their file; files are queued for removal, row soft-deleted', async () => {
    const created = await upload(user.bearer)
      .field('kind', 'avatar')
      .attach('file', await jpegBuffer(), 'del.jpg');
    const id = created.body.data.id as string;
    const url = created.body.data.url as string;
    enqueue.mockClear();

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/media/${id}`)
      .set('Authorization', user.bearer);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true });
    expect(enqueue).toHaveBeenCalledTimes(1);

    // Row is gone for serving.
    const served = await request(app.getHttpServer()).get(url);
    expect(served.status).toBe(404);
    // Deleting again 404s (already deleted).
    const again = await request(app.getHttpServer())
      .delete(`/api/v1/media/${id}`)
      .set('Authorization', user.bearer);
    expect(again.status).toBe(404);
  });
});

describe('rate limit (30 uploads / hour / user, failClosed)', () => {
  it('rejects the 31st upload attempt with 429 + Retry-After', async () => {
    await createUser(app, { username: 'ratelimituser', password: 'Sup3rSecret!2026' });
    const session = await loginAs(app, 'ratelimituser', 'Sup3rSecret!2026');
    let last = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await upload(session.bearer)
        .field('kind', 'avatar')
        .attach('file', Buffer.from('not an image'), 'x.jpg');
      last = res.status;
      if (res.status === 429) {
        expect(res.headers['retry-after']).toBeDefined();
      }
    }
    expect(last).toBe(429);
  });
});
