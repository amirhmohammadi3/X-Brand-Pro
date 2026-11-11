import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { FollowsService, FOLLOWS_EVENTS } from '../src/modules/follows/follows.service.js';
import type {
  FeedRow,
  FollowMeta,
  FollowsRepositoryLike,
  UserCard,
} from '../src/modules/follows/follows.repository.js';
import type { ActivityType, BusinessSummary } from '@app/contracts';
import { FOLLOW_MAX_PER_USER } from '@app/contracts';

/**
 * B5.2 FollowsService — the business rules, DB-free: the active-only gates
 * (business AND user targets), the no-existence-leak 404 for blocked
 * targets, the self-follow refusal, the 409 on a double follow, the
 * IDEMPOTENT unfollow (always answers the toggle state), the per-user cap,
 * the card ordering in /follows/me and the feed page mapping (active
 * actors only, both scopes OR-ed). The subscriber wiring is tested at the
 * HTTP level (follows.api.spec.ts) where the real EventEmitter2 runs.
 */

const USER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const BLOCKED_USER = '34343434-3434-4343-8434-343434343434';
const BIZ = '11111111-1111-4111-8111-111111111111';
const PENDING_BIZ = '12121212-1212-4212-8212-121212121212';
const DELETED_BIZ = '13131313-1313-4313-8313-131313131313';

function businessCard(id: string): BusinessSummary {
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

/** In-memory follows repo mirroring the SQL semantics the service relies on. */
function makeRepo() {
  const followsRows = new Map<string, FollowMeta>();
  const activities = new Map<
    string,
    {
      actorId: string;
      type: ActivityType;
      businessId: string | null;
      subjectId: string | null;
      createdAt: Date;
    }
  >();
  const biz = new Map<string, { status: string; deletedAt: Date | null }>([
    [BIZ, { status: 'active', deletedAt: null }],
    [PENDING_BIZ, { status: 'pending', deletedAt: null }],
    [DELETED_BIZ, { status: 'active', deletedAt: new Date() }],
  ]);
  const usersCtx = new Map<string, { status: string }>([
    [USER, { status: 'active' }],
    [STRANGER, { status: 'active' }],
    [BLOCKED_USER, { status: 'blocked' }],
  ]);
  const userCards = new Map<string, UserCard>([
    [
      STRANGER,
      {
        id: STRANGER,
        username: 'stranger',
        displayName: 'غریبه',
        avatarMediaKey: 'k1',
        avatarMediaThumbKey: 't1',
      },
    ],
    [
      BLOCKED_USER,
      {
        id: BLOCKED_USER,
        username: 'blocked',
        displayName: null,
        avatarMediaKey: null,
        avatarMediaThumbKey: null,
      },
    ],
  ]);
  let seq = 0;
  const nextId = () => `8${String(++seq).padStart(7, '0')}-8888-4888-8888-888888888888`;
  const isFollowing = (followerId: string, target: { businessId?: string; userId?: string }) =>
    [...followsRows.values()].some(
      (r) =>
        r.followerId === followerId &&
        (target.businessId ? r.businessId === target.businessId : r.userId === target.userId),
    );
  const repo: FollowsRepositoryLike = {
    async findBusinessContext(businessId) {
      return biz.get(businessId) ?? null;
    },
    async findUserContext(userId) {
      return usersCtx.get(userId) ?? null;
    },
    async insertFollow(input) {
      const dup = input.businessId
        ? isFollowing(input.followerId, { businessId: input.businessId })
        : isFollowing(input.followerId, { userId: input.userId as string });
      if (dup) return null;
      const row: FollowMeta = {
        id: nextId(),
        followerId: input.followerId,
        businessId: input.businessId ?? null,
        userId: input.userId ?? null,
        createdAt: new Date(1_700_000_000_000 + followsRows.size * 1_000),
      };
      followsRows.set(row.id, row);
      return { ...row };
    },
    async findFollowByBusiness(followerId, businessId) {
      const row = [...followsRows.values()].find(
        (r) => r.followerId === followerId && r.businessId === businessId,
      );
      return row ? { ...row } : null;
    },
    async findFollowByUser(followerId, userId) {
      const row = [...followsRows.values()].find(
        (r) => r.followerId === followerId && r.userId === userId,
      );
      return row ? { ...row } : null;
    },
    async deleteFollow(followId) {
      followsRows.delete(followId);
    },
    async countFollowsByFollower(followerId) {
      return [...followsRows.values()].filter((r) => r.followerId === followerId).length;
    },
    async listFollowedBusinessRows(followerId) {
      return [...followsRows.values()]
        .filter(
          (r) =>
            r.followerId === followerId &&
            r.businessId &&
            biz.get(r.businessId)?.status === 'active' &&
            !biz.get(r.businessId)?.deletedAt,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ businessId: r.businessId as string, followedAt: r.createdAt }));
    },
    async listFollowedUserRows(followerId) {
      return [...followsRows.values()]
        .filter(
          (r) =>
            r.followerId === followerId && r.userId && usersCtx.get(r.userId)?.status === 'active',
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ userId: r.userId as string, followedAt: r.createdAt }));
    },
    async findUserCards(userIds) {
      return userIds.filter((id) => userCards.has(id)).map((id) => userCards.get(id) as UserCard);
    },
    async insertActivityEvent(input) {
      const row = { ...input, createdAt: new Date(1_700_000_000_000 + activities.size * 1_000) };
      activities.set(`${input.type}:${input.subjectId}`, row);
    },
    async deleteActivityEventsBy(type, subjectId) {
      activities.delete(`${type}:${subjectId}`);
    },
    async ensureActivityEvent(input) {
      if (activities.has(`${input.type}:${input.subjectId}`)) return;
      await repo.insertActivityEvent(input);
    },
    async feedPage(input) {
      const followedU = new Set(input.followedUserIds);
      const followedB = new Set(input.followedBusinessIds);
      const rows: FeedRow[] = [...activities.values()]
        .filter(
          (a) => followedU.has(a.actorId) || (a.businessId !== null && followedB.has(a.businessId)),
        )
        .filter((a) => (input.type ? a.type === input.type : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((a) => ({
          id: nextId(),
          type: a.type,
          subjectId: a.subjectId,
          createdAt: a.createdAt,
          actorId: a.actorId,
          actorUsername: userCards.get(a.actorId)?.username ?? 'unknown',
          actorDisplayName: userCards.get(a.actorId)?.displayName ?? null,
          actorAvatarMediaKey: userCards.get(a.actorId)?.avatarMediaKey ?? null,
          actorAvatarMediaThumbKey: userCards.get(a.actorId)?.avatarMediaThumbKey ?? null,
          businessId: a.businessId,
          businessSlug: a.businessId ? `biz-${a.businessId.slice(0, 4)}` : null,
          businessName: a.businessId ? 'کافه نمونه' : null,
        }));
      const paged = rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
      return { rows: paged, total: rows.length };
    },
  };
  return { repo, followsRows, activities, usersCtx };
}

function makeService() {
  const { repo, followsRows, activities, usersCtx } = makeRepo();
  const events: Array<{ name: string; payload: unknown }> = [];
  const emitter = {
    emit(name: string, payload: unknown) {
      events.push({ name, payload });
    },
  } as unknown as EventEmitter2;
  const businesses = {
    async findSummariesByIds(ids: string[]) {
      return ids.map((id) => businessCard(id));
    },
  } as never; // the narrow slice FollowsService consumes
  const service = new FollowsService(
    repo,
    businesses,
    {
      urlForMedia: (media: { key: string }) => (media.key ? `https://cdn.test/${media.key}` : null),
      urlFor: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
    } as never,
    emitter,
  );
  return { service, repo, followsRows, activities, events, usersCtx };
}

async function httpStatus(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  throw new Error('expected the call to throw an HttpException');
}

describe('FollowsService — B5.2', () => {
  // ─── follow business ────────────────────────────────────────────────────

  it('followBusiness gates: 404 missing/deleted, 422 non-active, 409 double', async () => {
    const { service } = makeService();
    expect(
      await httpStatus(() => service.followBusiness(USER, '71717171-7171-4717-8717-717171717171')),
    ).toBe(404);
    expect(await httpStatus(() => service.followBusiness(USER, DELETED_BIZ))).toBe(404);
    expect(await httpStatus(() => service.followBusiness(USER, PENDING_BIZ))).toBe(422);
    const ok = await service.followBusiness(USER, BIZ);
    expect(ok).toEqual({ kind: 'business', targetId: BIZ, following: true });
    expect(await httpStatus(() => service.followBusiness(USER, BIZ))).toBe(409);
  });

  it('followBusiness emits follow.created with follower/kind/target', async () => {
    const { service, events } = makeService();
    await service.followBusiness(USER, BIZ);
    expect(events).toContainEqual({
      name: FOLLOWS_EVENTS.followed,
      payload: { followerId: USER, kind: 'business', targetId: BIZ },
    });
  });

  it('followUser refuses self-follow (422) and blocked targets (404, no leak)', async () => {
    const { service } = makeService();
    expect(await httpStatus(() => service.followUser(USER, USER))).toBe(422);
    expect(
      await httpStatus(() => service.followUser(USER, '72727272-7272-4727-8727-727272727272')),
    ).toBe(404);
    // a blocked user answers the SAME 404 as an unknown id
    expect(await httpStatus(() => service.followUser(USER, BLOCKED_USER))).toBe(404);
    const ok = await service.followBusiness(USER, BIZ);
    expect(ok.following).toBe(true);
    const follow = await service.followUser(STRANGER, USER);
    expect(follow).toEqual({ kind: 'user', targetId: USER, following: true });
  });

  it('the per-user cap (both kinds) is 422', async () => {
    const { service, usersCtx } = makeService();
    // fill the cap with active user targets
    for (let i = 0; i < FOLLOW_MAX_PER_USER; i++) {
      const id = `a${String(i).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      usersCtx.set(id, { status: 'active' });
      await service.followUser(USER, id);
    }
    expect(await httpStatus(() => service.followBusiness(USER, BIZ))).toBe(422);
  });

  it('unfollow is idempotent — answers following:false even for unknown targets', async () => {
    const { service, events } = makeService();
    await service.followBusiness(USER, BIZ);
    events.length = 0;
    const off = await service.unfollowBusiness(USER, BIZ);
    expect(off).toEqual({ kind: 'business', targetId: BIZ, following: false });
    expect(events).toContainEqual({
      name: FOLLOWS_EVENTS.unfollowed,
      payload: { followerId: USER, kind: 'business', targetId: BIZ },
    });
    events.length = 0;
    // second unfollow: no row, no event, still a clean answer
    const again = await service.unfollowBusiness(USER, BIZ);
    expect(again.following).toBe(false);
    expect(events).toEqual([]);
    // unknown target — same clean answer (no existence leak)
    const unknown = await service.unfollowUser(USER, '73737373-7373-4737-8737-737373737373');
    expect(unknown).toEqual({
      kind: 'user',
      targetId: '73737373-7373-4737-8737-737373737373',
      following: false,
    });
  });

  // ─── /follows/me ────────────────────────────────────────────────────────

  it('listMine joins business cards + user cards, newest follows first', async () => {
    const { service } = makeService();
    await service.followBusiness(USER, BIZ);
    await service.followUser(USER, STRANGER);
    const mine = await service.listMine(USER);
    expect(mine.businesses).toHaveLength(1);
    expect(mine.businesses[0]?.business.id).toBe(BIZ);
    expect(mine.businesses[0]?.followedAt).toBe(
      new Date(mine.businesses[0]!.followedAt).toISOString(),
    );
    expect(mine.users).toHaveLength(1);
    expect(mine.users[0]).toMatchObject({
      id: STRANGER,
      username: 'stranger',
      avatarUrl: 'https://cdn.test/k1',
    });
    // a blocked target cannot even be followed (the B4.10 404 rule) — so a
    // blocked id can never appear here; the SQL-side status filter is the
    // defense-in-depth for rows that existed BEFORE a block.
    expect(await httpStatus(() => service.followUser(USER, BLOCKED_USER))).toBe(404);
    const mine2 = await service.listMine(USER);
    expect(mine2.users.map((u) => u.id)).toEqual([STRANGER]);
  });

  // ─── feed ───────────────────────────────────────────────────────────────

  it('feed ORs the two scopes: followed actors and followed businesses', async () => {
    const { service, repo } = makeService();
    await service.followBusiness(USER, BIZ); // business scope
    await service.followUser(USER, STRANGER); // actor scope
    // activity by the followed actor on an UNFOLLOWED business → in feed
    await repo.insertActivityEvent({
      actorId: STRANGER,
      type: 'review.created',
      businessId: PENDING_BIZ,
      subjectId: '75757575-7575-4757-8757-757575757575',
    });
    // activity by an UNKNOWN actor on the FOLLOWED business → in feed
    await repo.insertActivityEvent({
      actorId: '76767676-7676-4767-8776-767676767676',
      type: 'favorite.added',
      businessId: BIZ,
      subjectId: '77777777-7777-4777-8777-777777777777',
    });
    // activity by an unknown actor on an unknown business → NOT in feed
    await repo.insertActivityEvent({
      actorId: '78787878-7878-4787-8778-787878787878',
      type: 'question.created',
      businessId: PENDING_BIZ,
      subjectId: '79797979-7979-4797-8797-797979797979',
    });
    const feed = await service.feed(USER, { page: 1, pageSize: 20 });
    expect(feed.meta.total).toBe(2);
    expect(feed.items.map((i) => i.type).sort()).toEqual(['favorite.added', 'review.created']);
    // actor cards resolved; business context present
    const reviewItem = feed.items.find((i) => i.type === 'review.created');
    expect(reviewItem?.actor.username).toBe('stranger');
    expect(reviewItem?.business).toMatchObject({ id: PENDING_BIZ });
  });

  it('feed honors the type filter and pagination meta', async () => {
    const { service, repo } = makeService();
    await service.followUser(USER, STRANGER);
    for (let i = 0; i < 3; i++) {
      await repo.insertActivityEvent({
        actorId: STRANGER,
        type: i % 2 === 0 ? 'review.created' : 'favorite.added',
        businessId: BIZ,
        subjectId: `7${String(i).padStart(7, '0')}-7000-4700-8700-70000000000${i}`,
      });
    }
    const onlyReviews = await service.feed(USER, { page: 1, pageSize: 20, type: 'review.created' });
    expect(onlyReviews.meta.total).toBe(2);
    expect(onlyReviews.items.every((i) => i.type === 'review.created')).toBe(true);
    const page1 = await service.feed(USER, { page: 1, pageSize: 2 });
    expect(page1.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page1.items).toHaveLength(2);
  });

  it('an empty follow graph answers an empty feed with zero totals', async () => {
    const { service } = makeService();
    const feed = await service.feed(USER, { page: 1, pageSize: 20 });
    expect(feed).toEqual({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });
});
