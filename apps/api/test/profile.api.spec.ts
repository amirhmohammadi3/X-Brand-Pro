import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { OAUTH_ACCOUNTS_REPOSITORY } from '../src/modules/auth/oauth-accounts.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { MEDIA_SERVICE } from '../src/modules/media/media.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type MediaRowLite,
} from './auth.utils.js';

/**
 * Profile API tests (B1.10) WITHOUT live services: Redis is FakeRedis, the
 * user/session/oauth repositories are in-memory fakes and MediaService is a
 * recording fake. Real controller, guards, pipes, envelope and services run.
 */
let app: INestApplication;
let redis: FakeRedis;
let sessionRepo: ReturnType<typeof makeMemorySessionRepo>;
let userRepo: ReturnType<typeof makeMemoryUserRepo>;
let oauthStore: Map<
  string,
  { id: string; userId: string; provider: string; providerUserId: string; email: string | null }
>;
let deletedMedia: string[];

const ORIGIN = 'http://localhost:3100'; // PUBLIC_WEB_URL from global-setup

/** In-memory MediaService fake: only the two calls the profile flow makes. */
const fakeMedia = {
  async markAttached(mediaId: string, ownerId: string): Promise<MediaRowLite & { id: string }> {
    const media = userRepo.mediaRows.get(mediaId);
    if (!media || media.deletedAt) {
      throw new Error('not found');
    }
    if (media.ownerUserId !== ownerId) {
      throw new Error('forbidden');
    }
    media.attachedAt = new Date();
    return { ...media, id: media.id };
  },
  async deleteOwned(mediaId: string): Promise<void> {
    deletedMedia.push(mediaId);
    const media = userRepo.mediaRows.get(mediaId);
    if (media) media.deletedAt = new Date();
  },
};

function addMedia(params: {
  ownerId: string;
  kind?: string;
  key?: string;
}): MediaRowLite & { id: string } {
  const row: MediaRowLite & { id: string } = {
    id: randomUUID(),
    key: params.key ?? `avatar/2026/11/${randomUUID()}.webp`,
    thumbKey: null,
    ownerUserId: params.ownerId,
    kind: params.kind ?? 'avatar',
    deletedAt: null,
    attachedAt: null,
  };
  userRepo.mediaRows.set(row.id, row);
  return row;
}

beforeAll(async () => {
  redis = new FakeRedis();
  sessionRepo = makeMemorySessionRepo();
  userRepo = makeMemoryUserRepo();
  oauthStore = new Map();
  deletedMedia = [];

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(sessionRepo)
    .overrideProvider(USERS_REPOSITORY)
    .useValue(userRepo)
    .overrideProvider(MEDIA_SERVICE)
    .useValue(fakeMedia)
    .overrideProvider(OAUTH_ACCOUNTS_REPOSITORY)
    .useValue({
      async insert(row: {
        userId: string;
        provider: string;
        providerUserId: string;
        email: string | null;
      }) {
        const id = randomUUID();
        const out = {
          id,
          userId: row.userId,
          provider: row.provider,
          providerUserId: row.providerUserId,
          email: row.email,
        };
        oauthStore.set(id, out);
        return out;
      },
      async findByProviderUid() {
        return null;
      },
      async listForUser(userId: string) {
        return [...oauthStore.values()].filter((r) => r.userId === userId);
      },
      async findByIdForUser(id: string, userId: string) {
        return oauthStore.get(id)?.userId === userId ? oauthStore.get(id)! : null;
      },
      async deleteByIdForUser(id: string, userId: string) {
        const row = oauthStore.get(id);
        if (row?.userId === userId) {
          oauthStore.delete(id);
          return true;
        }
        return false;
      },
      async deleteForUser(userId: string) {
        let n = 0;
        for (const [k, r] of oauthStore) {
          if (r.userId === userId) {
            oauthStore.delete(k);
            n += 1;
          }
        }
        return n;
      },
      async countForUser(userId: string) {
        return [...oauthStore.values()].filter((r) => r.userId === userId).length;
      },
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

function get(path: string) {
  return request(app.getHttpServer()).get(path);
}
function patch(path: string) {
  return request(app.getHttpServer()).patch(path);
}
function put(path: string) {
  return request(app.getHttpServer()).put(path);
}
function del(path: string) {
  return request(app.getHttpServer()).delete(path);
}
function post(path: string) {
  return request(app.getHttpServer()).post(path);
}

function authed(verb: { (p: string): request.Test }, cookies: string[], path: string) {
  return verb(path).set('Cookie', cookies.join('; ')).set('Origin', ORIGIN);
}

describe('GET /api/v1/users/me (B1.10)', () => {
  it('401 without login', async () => {
    await get('/api/v1/users/me').expect(401);
  });

  it('returns the current user with profile fields and hasPassword', async () => {
    const user = await createUser(app, { username: 'profile_me', password: 'Sup3rSecret!' });
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    const res = await get('/api/v1/users/me').set('Authorization', s.bearer).expect(200);
    expect(res.body.data).toMatchObject({
      id: user.id,
      username: 'profile_me',
      bio: null,
      avatarUrl: null,
      hasPassword: true,
      updatedAt: expect.any(String),
    });
  });
});

describe('PATCH /api/v1/users/me (B1.10)', () => {
  it('trims and normalizes Persian text, maps region locales to base', async () => {
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    const res = await authed(patch, s.cookies, '/api/v1/users/me')
      .send({ displayName: '  امیر  محمدی ', bio: '  سلام دنیا  ', locale: 'fa-IR' })
      .expect(200);
    expect(res.body.data.displayName).toBe('امیر محمدی');
    expect(res.body.data.bio).toBe('سلام دنیا');
    expect(res.body.data.locale).toBe('fa');
  });

  it('rejects an unsupported locale with 422 and a too-long displayName with 400', async () => {
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    await authed(patch, s.cookies, '/api/v1/users/me').send({ locale: 'de' }).expect(422);
    await authed(patch, s.cookies, '/api/v1/users/me')
      .send({ displayName: 'x'.repeat(81) })
      .expect(400);
  });

  it('rejects unknown keys (strict body)', async () => {
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    await authed(patch, s.cookies, '/api/v1/users/me').send({ role: 'admin' }).expect(400);
  });
});

describe('PUT /users/me/avatar (B1.10)', () => {
  it('sets the avatar and schedules the previous one for deletion', async () => {
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    const first = addMedia({
      ownerId: (await get('/api/v1/users/me').set('Authorization', s.bearer).expect(200)).body.data
        .id,
    });
    const second = addMedia({ ownerId: first.ownerUserId as string });

    const res = await authed(put, s.cookies, '/api/v1/users/me/avatar')
      .send({ mediaId: first.id })
      .expect(200);
    expect(res.body.data.avatarUrl).toContain(first.key);

    const res2 = await authed(put, s.cookies, '/api/v1/users/me/avatar')
      .send({ mediaId: second.id })
      .expect(200);
    expect(res2.body.data.avatarUrl).toContain(second.key);
    // Old avatar was queued for removal.
    expect(deletedMedia).toContain(first.id);
  });

  it("rejects another user's media with 403 and a wrong kind with 422", async () => {
    const owner = await createUser(app, { username: 'media_owner', password: 'Sup3rSecret!' });
    const strangerMedia = addMedia({ ownerId: owner.id });
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    await authed(put, s.cookies, '/api/v1/users/me/avatar')
      .send({ mediaId: strangerMedia.id })
      .expect(403);

    const meRes = await get('/api/v1/users/me').set('Authorization', s.bearer).expect(200);
    const meId = meRes.body.data.id as string;
    const mine = addMedia({ ownerId: meId, kind: 'business_photo' });
    await authed(put, s.cookies, '/api/v1/users/me/avatar').send({ mediaId: mine.id }).expect(422);
  });

  it('DELETE /users/me/avatar clears it and queues removal', async () => {
    const s = await loginAs(app, 'profile_me', 'Sup3rSecret!');
    const res = await authed(del, s.cookies, '/api/v1/users/me/avatar').expect(200);
    expect(res.body.data.avatarUrl).toBeNull();
    expect(deletedMedia.length).toBeGreaterThan(0);
  });
});

describe('POST /users/me/username (B1.10)', () => {
  it('changes the username, then rejects the second change within 30 days (422 + retryAt)', async () => {
    const user = await createUser(app, { username: 'coolname1', password: 'Sup3rSecret!' });
    const s = await loginAs(app, 'coolname1', 'Sup3rSecret!');

    const res = await authed(post, s.cookies, '/api/v1/users/me/username')
      .send({ username: 'coolname2' })
      .expect(200);
    expect(res.body.data.username).toBe('coolname2');

    const res2 = await authed(post, s.cookies, '/api/v1/users/me/username')
      .send({ username: 'coolname3' })
      .expect(422);
    const retryAt = new Date(res2.body.error.details.retryAt as string);
    expect(retryAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(userRepo.rows.get(user.id)?.username).toBe('coolname2');
  });

  it('allows a change when the cooldown elapsed (fake clock via usernameChangedAt)', async () => {
    const user = await createUser(app, { username: 'old_handle', password: 'Sup3rSecret!' });
    const s = await loginAs(app, 'old_handle', 'Sup3rSecret!');
    // Pretend the previous change happened 31 days ago.
    const row = userRepo.rows.get(user.id);
    if (row) {
      row.usernameChangedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    }
    await authed(post, s.cookies, '/api/v1/users/me/username')
      .send({ username: 'new_handle' })
      .expect(200);
  });

  it('409 on a duplicate username', async () => {
    await createUser(app, { username: 'taken_name', password: 'Sup3rSecret!' });
    const user = await createUser(app, { username: 'changer_one', password: 'Sup3rSecret!' });
    const s = await loginAs(app, 'changer_one', 'Sup3rSecret!');
    const res = await authed(post, s.cookies, '/api/v1/users/me/username')
      .send({ username: 'taken_name' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(userRepo.rows.get(user.id)?.username).toBe('changer_one');
  });
});

describe('POST /users/me/password (B1.10)', () => {
  // The RateLimit guard runs before JwtAuth, so scope:'user' falls back to a
  // shared IP bucket in tests — clear the counters between scenarios.
  beforeEach(async () => {
    for (const key of [...redis.keys()]) {
      if (key.startsWith('rl:users.change_password')) await redis.del(key);
    }
  });

  it('requires the current password for password users; wrong answers are 401', async () => {
    await createUser(app, { username: 'pwchanger', password: 'OldPass123' });
    const s = await loginAs(app, 'pwchanger', 'OldPass123');

    await authed(post, s.cookies, '/api/v1/users/me/password')
      .send({ newPassword: 'NewPass123' })
      .expect(422);
    await authed(post, s.cookies, '/api/v1/users/me/password')
      .send({ currentPassword: 'WrongPass1', newPassword: 'NewPass123' })
      .expect(401);
    await authed(post, s.cookies, '/api/v1/users/me/password')
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass123' })
      .expect(204);

    // Old password no longer works; new one does.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'pwchanger', password: 'OldPass123' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'pwchanger', password: 'NewPass123' })
      .expect(200);
  });

  it('sets a first password for a no-password user only with a verified identifier', async () => {
    // OTP/Google-shaped user: log in while a password exists, then strip the
    // hash to simulate an OTP-created account (the session stays valid).
    const user = await createUser(app, { username: 'otp_user1', password: 'TempPass1' });
    const s = await loginAs(app, 'otp_user1', 'TempPass1');
    const row = userRepo.rows.get(user.id);
    if (row) {
      row.passwordHash = null; // simulate an OTP-created account
    }
    await authed(post, s.cookies, '/api/v1/users/me/password')
      .send({ newPassword: 'FreshPass1' })
      .expect(422);

    if (row) {
      row.emailVerifiedAt = new Date(); // B1.7 verified the email via OTP
    }
    await authed(post, s.cookies, '/api/v1/users/me/password')
      .send({ newPassword: 'FreshPass1' })
      .expect(204);
    expect(userRepo.rows.get(user.id)?.passwordHash).not.toBeNull();
  });

  it('revokes all OTHER sessions and keeps the current one', async () => {
    await createUser(app, { username: 'multises', password: 'OldPass123' });
    const s1 = await loginAs(app, 'multises', 'OldPass123');
    const s2 = await loginAs(app, 'multises', 'OldPass123');

    await authed(post, s1.cookies, '/api/v1/users/me/password')
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass123' })
      .expect(204);

    // Current session still valid.
    await get('/api/v1/users/me').set('Authorization', s1.bearer).expect(200);
    // The other session is revoked (guard reads the live session row).
    const res = await get('/api/v1/users/me').set('Authorization', s2.bearer).expect(401);
    expect(['SESSION_REVOKED', 'UNAUTHENTICATED']).toContain(res.body.error.code);
  });
});

describe('DELETE /api/v1/users/me (B1.10)', () => {
  it('requires the password, anonymizes the row, revokes sessions, blocks old credentials', async () => {
    const user = await createUser(app, {
      username: 'doomed_user',
      password: 'ByePass123',
      email: 'doomed@example.com',
    });
    const s = await loginAs(app, 'doomed_user', 'ByePass123');

    await authed(del, s.cookies, '/api/v1/users/me').send({ confirm: 'DELETE' }).expect(422);
    await authed(del, s.cookies, '/api/v1/users/me')
      .send({ confirm: 'DELETE', password: 'WrongPass1' })
      .expect(401);
    await authed(del, s.cookies, '/api/v1/users/me')
      .send({ confirm: 'DELETE', password: 'ByePass123' })
      .expect(204);

    const row = userRepo.rows.get(user.id);
    expect(row).toMatchObject({
      status: 'deleted',
      email: null,
      phone: null,
      passwordHash: null,
      displayName: null,
      bio: null,
    });
    expect(row?.username).toBe(`deleted_${user.id.slice(0, 8)}`);
    expect(oauthStore.size).toBe(0);

    // Old credentials no longer log in.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'doomed_user', password: 'ByePass123' })
      .expect(401);
    // Old bearer stops working (session revoked).
    await get('/api/v1/users/me').set('Authorization', s.bearer).expect(401);
  });

  it('deletes a no-password account with a fresh session (no password required)', async () => {
    const user = await createUser(app, { username: 'otp_delete', password: 'TempPass1' });
    const s = await loginAs(app, 'otp_delete', 'TempPass1');
    const row = userRepo.rows.get(user.id);
    if (row) row.passwordHash = null; // simulate an OTP-created account

    await authed(del, s.cookies, '/api/v1/users/me').send({ confirm: 'DELETE' }).expect(204);
    expect(userRepo.rows.get(user.id)?.status).toBe('deleted');
  });
});
