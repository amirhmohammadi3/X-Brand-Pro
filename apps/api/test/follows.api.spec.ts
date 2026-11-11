import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AUDIT_SERVICE } from '../src/modules/audit/audit.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { BUSINESSES_REPOSITORY } from '../src/modules/business/businesses.repository.js';
import { FOLLOWS_REPOSITORY } from '../src/modules/follows/follows.repository.js';
import { FAVORITES_REPOSITORY } from '../src/modules/favorites/favorites.repository.js';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level follows/feed tests (B5.2) WITHOUT live services: Redis is
 * FakeRedis, user/session repositories are in-memory fakes, the follows
 * repository is an in-memory fake (the real SQL needs Postgres — Docker
 * follow-up), the businesses repository is a card-returning fake, the
 * favorites repository is a minimal fake so the REAL favorite flow can
 * emit `favorite.added` through the real EventEmitter2 and the REAL
 * FollowsActivitySubscriber can turn it into a feed row. Everything else —
 * controllers, guards (RateLimit → JwtAuth → CsrfOrigin), envelope,
 * subscriber wiring — runs for real.
 */

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const PENDING = '12121212-1212-4212-8212-121212121212';
const MISSING = '14141414-1414-4414-8414-141414141414';
const REVIEW_ID = '75757575-7575-4757-8757-757575757575';

function cardFor(id: string) {
  return {
    id,
    slug: `biz-${id.slice(0, 4)}`,
    name: 'کافه نمونه',
    nameAlt: null,
    primaryCategory: {
      id: '61616161-6161-4616-8661-616161616161',
      slug: 'cafe',
      name: { fa: 'کافه' },
    },
    city: { id: '62626262-6262-4626-8662-626262626262', slug: 'tehran', name: { fa: 'تهران' } },
    neighborhood: null,
    address: 'تهران، خیابان نمونه',
    location: { lat: 35.7, lng: 51.4 },
    priceLevel: 2,
    avgRating: 4.5,
    reviewCount: 12,
    coverUrl: null,
    thumbUrl: null,
    isFeatured: false,
    isClaimed: false,
  };
}

interface FakeListRow {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
interface FakeItemRow {
  id: string;
  userId: string;
  listId: string;
  businessId: string;
  note: string | null;
  createdAt: Date;
}

/** Minimal favorites fake — only what the heart-on flow needs to run for real. */
function makeMemoryFavoritesRepo() {
  const lists = new Map<string, FakeListRow>();
  const items = new Map<string, FakeItemRow>();
  let seq = 0;
  const nextId = () => `a${String(++seq).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  return {
    async listSummariesByUser(userId: string) {
      return [...lists.values()]
        .filter((l) => l.userId === userId)
        .map((l) => ({
          ...l,
          itemCount: [...items.values()].filter((i) => i.listId === l.id).length,
        }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    },
    async findListById(listId: string) {
      const row = lists.get(listId);
      return row ? { ...row } : null;
    },
    async findDefaultList(userId: string) {
      const row = [...lists.values()].find((l) => l.userId === userId && l.isDefault);
      return row ? { ...row } : null;
    },
    async countListsByUser(userId: string) {
      return [...lists.values()].filter((l) => l.userId === userId).length;
    },
    async insertList(input: { userId: string; name: string; isDefault: boolean }) {
      if (
        input.isDefault &&
        [...lists.values()].some((l) => l.userId === input.userId && l.isDefault)
      )
        return null;
      const row: FakeListRow = {
        id: nextId(),
        userId: input.userId,
        name: input.name,
        isDefault: input.isDefault,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      lists.set(row.id, row);
      return { ...row };
    },
    async renameList() {},
    async deleteList() {},
    async insertItem(input: {
      userId: string;
      listId: string;
      businessId: string;
      note: string | null;
    }) {
      if (
        [...items.values()].some(
          (i) => i.userId === input.userId && i.businessId === input.businessId,
        )
      )
        return null;
      const row: FakeItemRow = {
        id: nextId(),
        userId: input.userId,
        listId: input.listId,
        businessId: input.businessId,
        note: input.note,
        createdAt: new Date(),
      };
      items.set(row.id, row);
      return { ...row };
    },
    async findItemById(itemId: string) {
      const row = items.get(itemId);
      return row ? { ...row } : null;
    },
    async findItemByUserAndBusiness(userId: string, businessId: string) {
      const row = [...items.values()].find(
        (i) => i.userId === userId && i.businessId === businessId,
      );
      return row ? { ...row, listName: '' } : null;
    },
    async countItemsInList(listId: string) {
      return [...items.values()].filter((i) => i.listId === listId).length;
    },
    async listItemRows(listId: string, page: number, pageSize: number) {
      const rows = [...items.values()].filter((i) => i.listId === listId);
      return {
        rows: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r })),
        total: rows.length,
      };
    },
    async updateItem() {},
    async deleteItem(itemId: string) {
      items.delete(itemId);
    },
    async findBusinessContext(businessId: string) {
      if (businessId === MISSING) return null;
      if (businessId === PENDING) return { status: 'pending', deletedAt: null };
      if (businessId === ACTIVE) return { status: 'active', deletedAt: null };
      return null;
    },
  };
}

type FavoritesRepoFake = ReturnType<typeof makeMemoryFavoritesRepo>;

/** In-memory follows repo (the same semantics as the service spec's fake). */
function makeMemoryFollowsRepo() {
  const followRows = new Map<
    string,
    {
      id: string;
      followerId: string;
      businessId: string | null;
      userId: string | null;
      createdAt: Date;
    }
  >();
  const activities = new Map<
    string,
    {
      actorId: string;
      type: string;
      businessId: string | null;
      subjectId: string | null;
      createdAt: Date;
    }
  >();
  const usersCtx = new Map<string, { status: string }>();
  let seq = 0;
  const nextId = () => `b${String(++seq).padStart(7, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
  const insertActivity = (input: ActivityInput) =>
    makeMemoryFollowsRepo_insertActivity(activities, input);
  return {
    followRows,
    activities,
    usersCtx,
    async findBusinessContext(businessId: string) {
      if (businessId === ACTIVE) return { status: 'active', deletedAt: null };
      if (businessId === PENDING) return { status: 'pending', deletedAt: null };
      if (businessId === MISSING) return null;
      return null;
    },
    async findUserContext(userId: string) {
      return usersCtx.get(userId) ?? null;
    },
    async insertFollow(input: {
      followerId: string;
      businessId?: string | null;
      userId?: string | null;
    }) {
      const dup = [...followRows.values()].some(
        (r) =>
          r.followerId === input.followerId &&
          (input.businessId ? r.businessId === input.businessId : r.userId === input.userId),
      );
      if (dup) return null;
      const row = {
        id: nextId(),
        followerId: input.followerId,
        businessId: input.businessId ?? null,
        userId: input.userId ?? null,
        createdAt: new Date(1_700_000_000_000 + followRows.size * 1_000),
      };
      followRows.set(row.id, row);
      return { ...row };
    },
    async findFollowByBusiness(followerId: string, businessId: string) {
      const row = [...followRows.values()].find(
        (r) => r.followerId === followerId && r.businessId === businessId,
      );
      return row ? { ...row } : null;
    },
    async findFollowByUser(followerId: string, userId: string) {
      const row = [...followRows.values()].find(
        (r) => r.followerId === followerId && r.userId === userId,
      );
      return row ? { ...row } : null;
    },
    async deleteFollow(followId: string) {
      followRows.delete(followId);
    },
    async countFollowsByFollower(followerId: string) {
      return [...followRows.values()].filter((r) => r.followerId === followerId).length;
    },
    async listFollowedBusinessRows(followerId: string) {
      return [...followRows.values()]
        .filter((r) => r.followerId === followerId && r.businessId === ACTIVE)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ businessId: r.businessId as string, followedAt: r.createdAt }));
    },
    async listFollowedUserRows(followerId: string) {
      return [...followRows.values()]
        .filter(
          (r) =>
            r.followerId === followerId && r.userId && usersCtx.get(r.userId)?.status === 'active',
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ userId: r.userId as string, followedAt: r.createdAt }));
    },
    async findUserCards(userIds: string[]) {
      return userIds
        .filter((id) => usersCtx.get(id)?.status === 'active')
        .map((id) => ({
          id,
          username: `user-${id.slice(0, 4)}`,
          displayName: null,
          avatarMediaKey: null,
          avatarMediaThumbKey: null,
        }));
    },
    async insertActivityEvent(input: {
      actorId: string;
      type: string;
      businessId: string | null;
      subjectId: string | null;
    }) {
      return insertActivity(input);
    },
    async deleteActivityEventsBy(type: string, subjectId: string) {
      activities.delete(`${type}:${subjectId}`);
    },
    async ensureActivityEvent(input: {
      actorId: string;
      type: string;
      businessId: string | null;
      subjectId: string | null;
    }) {
      if (activities.has(`${input.type}:${input.subjectId}`)) return;
      await insertActivity(input);
    },
    async feedPage(input: {
      followedUserIds: string[];
      followedBusinessIds: string[];
      type?: string;
      page: number;
      pageSize: number;
    }) {
      const followedU = new Set(input.followedUserIds);
      const followedB = new Set(input.followedBusinessIds);
      const rows = [...activities.values()]
        .filter(
          (a) => followedU.has(a.actorId) || (a.businessId !== null && followedB.has(a.businessId)),
        )
        .filter((a) => (input.type ? a.type === input.type : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        rows: rows
          .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
          .map((a) => ({
            id: nextId(),
            type: a.type,
            subjectId: a.subjectId,
            createdAt: a.createdAt,
            actorId: a.actorId,
            actorUsername: `user-${a.actorId.slice(0, 4)}`,
            actorDisplayName: null,
            actorAvatarMediaKey: null,
            actorAvatarMediaThumbKey: null,
            businessId: a.businessId,
            businessSlug: a.businessId ? `biz-${a.businessId.slice(0, 4)}` : null,
            businessName: a.businessId ? 'کافه نمونه' : null,
          })),
        total: rows.length,
      };
    },
  };
}

type ActivityInput = {
  actorId: string;
  type: string;
  businessId: string | null;
  subjectId: string | null;
};
function makeMemoryFollowsRepo_insertActivity(
  activities: Map<string, ActivityInput & { createdAt: Date }>,
  input: ActivityInput,
) {
  activities.set(`${input.type}:${input.subjectId}`, {
    ...input,
    createdAt: new Date(1_700_000_000_000 + activities.size * 1_000),
  });
}

type FollowsRepoFake = ReturnType<typeof makeMemoryFollowsRepo>;

function makeFakeSettingsRepo() {
  const store = new Map<
    string,
    { key: string; value: unknown; isSecret: boolean; group: string }
  >();
  return {
    store,
    async findAll() {
      return [...store.values()].map((r) => ({ ...r, description: null }));
    },
    async findByKey(key: string) {
      const row = store.get(key);
      return row ? { ...row, description: null } : null;
    },
    async upsert(row: { key: string; value: unknown; isSecret: boolean; group: string }) {
      const created = { ...row, description: null, updatedAt: new Date() };
      store.set(row.key, created);
      return created;
    },
  };
}

let app: INestApplication;
let emitter: EventEmitter2;
let followsRepo: FollowsRepoFake;
const auditActions: string[] = [];
let user: LoginSession;
let actor: LoginSession;
/** The REAL user ids (createUser mints UUIDs) — self/self tests need them. */
let userId: string;
let actorId: string;

beforeAll(async () => {
  const redis = new FakeRedis();
  followsRepo = makeMemoryFollowsRepo();
  const favRepo: FavoritesRepoFake = makeMemoryFavoritesRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined), route: vi.fn() })
    .overrideProvider(FOLLOWS_REPOSITORY)
    .useValue(followsRepo)
    .overrideProvider(FAVORITES_REPOSITORY)
    .useValue(favRepo)
    .overrideProvider(BUSINESSES_REPOSITORY)
    .useValue({
      async findSummariesByIds(ids: string[]) {
        return ids.filter((id) => id === ACTIVE).map((id) => cardFor(id));
      },
    })
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .overrideProvider(AUDIT_SERVICE)
    .useValue({
      log: (entry: { action: string }) => {
        auditActions.push(entry.action);
      },
      write: vi.fn(async () => ({ id: 'audit-1' })),
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();
  emitter = moduleRef.get(EventEmitter2);

  const userRow = await createUser(app, { username: 'followuser', password: 'Sup3rSecret!2026' });
  const actorRow = await createUser(app, { username: 'followactor', password: 'Sup3rSecret!2026' });
  user = await loginAs(app, 'followuser', 'Sup3rSecret!2026');
  actor = await loginAs(app, 'followactor', 'Sup3rSecret!2026');
  userId = userRow.id;
  actorId = actorRow.id;
  // the follows fake needs the target user context for follow-user flows
  followsRepo.usersCtx.set(actorRow.id, { status: 'active' });
  followsRepo.usersCtx.set(userRow.id, { status: 'active' });
});

afterAll(async () => {
  await app?.close();
});

const followBusiness = (id: string, bearer: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/follows/businesses/${id}`)
    .set({ Authorization: bearer });

const unfollowBusiness = (id: string, bearer: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/follows/businesses/${id}`)
    .set({ Authorization: bearer });

const followUser = (id: string, bearer: string) =>
  request(app.getHttpServer()).post(`/api/v1/follows/users/${id}`).set({ Authorization: bearer });

const unfollowUser = (id: string, bearer: string) =>
  request(app.getHttpServer()).delete(`/api/v1/follows/users/${id}`).set({ Authorization: bearer });

const getMine = (bearer: string) =>
  request(app.getHttpServer()).get('/api/v1/follows/me').set({ Authorization: bearer });

const getFeed = (query = '', bearer: string) =>
  request(app.getHttpServer()).get(`/api/v1/feed${query}`).set({ Authorization: bearer });

const heartOn = (bearer: string) =>
  request(app.getHttpServer())
    .post('/api/v1/favorites/items')
    .set({ Authorization: bearer })
    .send({ businessId: ACTIVE });

describe('Follows HTTP — B5.2', () => {
  it('401s every follows/feed route without a bearer', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/follows/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/v1/feed')).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).post(`/api/v1/follows/businesses/${ACTIVE}`)).status,
    ).toBe(401);
    expect(
      (await request(app.getHttpServer()).post(`/api/v1/follows/users/${ACTIVE}`)).status,
    ).toBe(401);
  });

  it('follow business: 201 → 409 on double → /me shows the card → idempotent DELETE', async () => {
    const on = await followBusiness(ACTIVE, user.bearer);
    expect(on.status).toBe(201);
    expect(on.body.data).toEqual({ kind: 'business', targetId: ACTIVE, following: true });

    const again = await followBusiness(ACTIVE, user.bearer);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');

    const mine = await getMine(user.bearer);
    expect(mine.body.data.businesses).toHaveLength(1);
    expect(mine.body.data.businesses[0].business).toMatchObject({ id: ACTIVE, name: 'کافه نمونه' });
    expect(mine.body.data.businesses[0].followedAt).toBeTypeOf('string');
    expect(mine.body.data.users).toEqual([]);

    const off = await unfollowBusiness(ACTIVE, user.bearer);
    expect(off.status).toBe(200);
    expect(off.body.data).toEqual({ kind: 'business', targetId: ACTIVE, following: false });
    const offAgain = await unfollowBusiness(ACTIVE, user.bearer);
    expect(offAgain.status).toBe(200);
    expect(offAgain.body.data.following).toBe(false);
  });

  it('follow user: self 422, unknown 404, real follow → /me users slice → unfollow', async () => {
    const self = await followUser(userId, user.bearer);
    expect(self.status).toBe(422);
    const unknown = await followUser(MISSING, user.bearer);
    expect(unknown.status).toBe(404);

    const on = await followUser(actorId, user.bearer);
    expect(on.status).toBe(201);
    expect(on.body.data).toEqual({ kind: 'user', targetId: actorId, following: true });

    const mine = await getMine(user.bearer);
    expect(mine.body.data.users).toHaveLength(1);
    expect(mine.body.data.users[0].id).toBe(actorId);

    const off = await unfollowUser(actorId, user.bearer);
    expect(off.status).toBe(200);
    expect(off.body.data.following).toBe(false);
  });

  it('a pending business cannot be followed (422) and a garbage uuid answers 422', async () => {
    const pending = await followBusiness(PENDING, user.bearer);
    expect(pending.status).toBe(422);
    const garbage = await request(app.getHttpServer())
      .post('/api/v1/follows/businesses/not-a-uuid')
      .set({ Authorization: user.bearer });
    expect(garbage.status).toBe(422);
  });

  it('the REAL subscriber turns the real favorite flow into a feed row (event wiring)', async () => {
    // user follows the business
    await followBusiness(ACTIVE, user.bearer);
    // the ACTOR hearts it through the REAL favorites controller (fake repo)
    const heart = await heartOn(actor.bearer);
    expect(heart.status).toBe(201);
    const itemId = heart.body.data.id as string;

    // give the best-effort handler a microtask to land
    await new Promise((r) => setTimeout(r, 20));

    const feed = await getFeed('', user.bearer);
    expect(feed.status).toBe(200);
    const favoriteItems = feed.body.data.items.filter(
      (i: { type: string }) => i.type === 'favorite.added',
    );
    expect(favoriteItems).toHaveLength(1);
    expect(favoriteItems[0]).toMatchObject({
      type: 'favorite.added',
      subjectId: itemId,
      actor: { id: actorId },
      business: { id: ACTIVE, slug: 'biz-1111', name: 'کافه نمونه' },
    });

    // heart-off → the subscriber RETRACTS the feed row
    await request(app.getHttpServer())
      .delete(`/api/v1/favorites/items/${itemId}`)
      .set({ Authorization: actor.bearer });
    await new Promise((r) => setTimeout(r, 20));
    const feedAfter = await getFeed('', user.bearer);
    expect(
      feedAfter.body.data.items.filter((i: { type: string }) => i.type === 'favorite.added'),
    ).toHaveLength(0);
    await unfollowBusiness(ACTIVE, user.bearer);
  });

  it('direct review events: created → feed row; demoted → retracted; re-approved → back', async () => {
    await followBusiness(ACTIVE, user.bearer);
    emitter.emit('review.created', {
      reviewId: REVIEW_ID,
      businessId: ACTIVE,
      userId: actorId,
      rating: 4,
    });
    await new Promise((r) => setTimeout(r, 20));
    let feed = await getFeed('', user.bearer);
    const reviewItem = feed.body.data.items.find(
      (i: { type: string }) => i.type === 'review.created',
    );
    expect(reviewItem?.subjectId).toBe(REVIEW_ID);

    // demotion retracts
    emitter.emit('review.status.changed', {
      reviewId: REVIEW_ID,
      businessId: ACTIVE,
      userId: actorId,
      from: 'approved',
      to: 'pending',
    });
    await new Promise((r) => setTimeout(r, 20));
    feed = await getFeed('', user.bearer);
    expect(
      feed.body.data.items.find((i: { type: string }) => i.type === 'review.created'),
    ).toBeUndefined();

    // re-approval restores (idempotent ensure)
    emitter.emit('review.status.changed', {
      reviewId: REVIEW_ID,
      businessId: ACTIVE,
      userId: actorId,
      from: 'pending',
      to: 'approved',
    });
    await new Promise((r) => setTimeout(r, 20));
    feed = await getFeed('', user.bearer);
    expect(
      feed.body.data.items.find((i: { type: string }) => i.type === 'review.created'),
    ).toMatchObject({
      subjectId: REVIEW_ID,
    });

    // deletion retracts too
    emitter.emit('review.deleted', { reviewId: REVIEW_ID, businessId: ACTIVE, userId: actorId });
    await new Promise((r) => setTimeout(r, 20));
    feed = await getFeed('', user.bearer);
    expect(
      feed.body.data.items.find((i: { type: string }) => i.type === 'review.created'),
    ).toBeUndefined();
    await unfollowBusiness(ACTIVE, user.bearer);
  });

  it('the feed type filter works over the HTTP layer', async () => {
    await followBusiness(ACTIVE, user.bearer);
    emitter.emit('question.created', {
      questionId: '76767676-7676-4767-8776-767676767676',
      businessId: ACTIVE,
      userId: actorId,
    });
    await new Promise((r) => setTimeout(r, 20));
    const filtered = await getFeed('?type=question.created', user.bearer);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0].type).toBe('question.created');
    expect(filtered.body.data.meta).toMatchObject({ page: 1, total: 1 });
    const empty = await getFeed('?type=review.created', user.bearer);
    expect(empty.body.data.items).toHaveLength(0);
  });

  it('follow writes are audited', async () => {
    expect(auditActions).toContain('follow.create');
    expect(auditActions).toContain('follow.remove');
  });
});
