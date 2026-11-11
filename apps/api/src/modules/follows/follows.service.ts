import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  FeedItem,
  FeedQuery,
  FeedResult,
  FollowedBusiness,
  FollowedUser,
  FollowResult,
  MyFollowsResult,
} from '@app/contracts';
import { FOLLOW_MAX_PER_USER } from '@app/contracts';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import {
  BUSINESSES_REPOSITORY,
  type BusinessesRepositoryLike,
} from '../business/businesses.repository.js';
import {
  FOLLOWS_REPOSITORY,
  type FollowsRepositoryLike,
  type UserCard,
} from './follows.repository.js';

/**
 * Domain events (AGENTS.md 6) — the follows module's own signals. B5.7's
 * notification wiring subscribes to `follow.created` (a new follower is the
 * classic notify-me event); nothing subscribes yet (B5.2 scope).
 */
export const FOLLOWS_EVENTS = {
  /** Someone followed a user or a business. */
  followed: 'follow.created',
  /** Someone unfollowed (idempotent DELETE — emitted only when a row existed). */
  unfollowed: 'follow.removed',
} as const;

function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
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

function conflictException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'CONFLICT' as const,
      messageKey: 'errors.conflict',
      message,
      details,
    },
    HttpStatus.CONFLICT,
  );
}

/**
 * Follows + the activity feed (B5.2). Rules:
 * - only `active` non-deleted businesses accept follows (404 missing/
 *   deleted, 422 otherwise — the B5.1 gate);
 * - only `active` users accept follows; a blocked/deleted target 404s with
 *   the SAME shape as an unknown id (the B4.10 no-existence-leak rule);
 * - self-follow is refused (422) — a user is their own feed's baseline, not
 *   a follow row;
 * - a double follow is a 409 (storage-level unique indexes), unfollow is
 *   IDEMPOTENT (DELETE always answers the toggle's new state — social UX;
 *   unknown/foreign targets simply answer `following:false`, never leaking
 *   existence);
 * - the per-user follows cap (both kinds) is 422, not a silent refusal;
 * - the feed is PULL-based over activity_events (subscriber-fed) and joins
 *   only `active` actors, so blocked users' rows vanish without cleanup;
 * - every successful follow/unfollow emits a domain event (B5.7).
 */
@Injectable()
export class FollowsService {
  constructor(
    @Inject(FOLLOWS_REPOSITORY) private readonly repo: FollowsRepositoryLike,
    @Inject(BUSINESSES_REPOSITORY) private readonly businesses: BusinessesRepositoryLike,
    private readonly mediaUrls: MediaUrlService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ─── follows ──────────────────────────────────────────────────────────────

  /** POST /follows/businesses/:id */
  async followBusiness(followerId: string, businessId: string): Promise<FollowResult> {
    const business = await this.repo.findBusinessContext(businessId);
    if (!business || business.deletedAt) {
      throw notFoundException('Business', businessId);
    }
    if (business.status !== 'active') {
      throw ruleException('Only active businesses can be followed', {
        businessId,
        status: business.status,
      });
    }
    await this.assertUnderFollowCap(followerId);
    const row = await this.repo.insertFollow({ followerId, businessId });
    if (!row) {
      throw conflictException('Already following this business', { businessId });
    }
    this.emitFollowed(followerId, 'business', businessId);
    return { kind: 'business', targetId: businessId, following: true };
  }

  /** POST /follows/users/:id */
  async followUser(followerId: string, targetUserId: string): Promise<FollowResult> {
    if (followerId === targetUserId) {
      throw ruleException('You cannot follow yourself', { targetUserId });
    }
    const user = await this.repo.findUserContext(targetUserId);
    // blocked/deleted answer the SAME 404 as unknown — no existence leak.
    if (!user || user.status !== 'active') {
      throw notFoundException('User', targetUserId);
    }
    await this.assertUnderFollowCap(followerId);
    const row = await this.repo.insertFollow({ followerId, userId: targetUserId });
    if (!row) {
      throw conflictException('Already following this user', { targetUserId });
    }
    this.emitFollowed(followerId, 'user', targetUserId);
    return { kind: 'user', targetId: targetUserId, following: true };
  }

  /** DELETE /follows/businesses/:id — idempotent (answers the toggle state). */
  async unfollowBusiness(followerId: string, businessId: string): Promise<FollowResult> {
    const row = await this.repo.findFollowByBusiness(followerId, businessId);
    if (row) {
      await this.repo.deleteFollow(row.id);
      this.emitUnfollowed(followerId, 'business', businessId);
    }
    return { kind: 'business', targetId: businessId, following: false };
  }

  /** DELETE /follows/users/:id — idempotent (answers the toggle state). */
  async unfollowUser(followerId: string, targetUserId: string): Promise<FollowResult> {
    const row = await this.repo.findFollowByUser(followerId, targetUserId);
    if (row) {
      await this.repo.deleteFollow(row.id);
      this.emitUnfollowed(followerId, 'user', targetUserId);
    }
    return { kind: 'user', targetId: targetUserId, following: false };
  }

  /** GET /follows/me — both slices, newest follows first, active rows only. */
  async listMine(followerId: string): Promise<MyFollowsResult> {
    const [businessRows, userRows] = await Promise.all([
      this.repo.listFollowedBusinessRows(followerId),
      this.repo.listFollowedUserRows(followerId),
    ]);
    const cards = await this.businesses.findSummariesByIds(businessRows.map((r) => r.businessId));
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const businessItems: FollowedBusiness[] = [];
    for (const row of businessRows) {
      const card = cardById.get(row.businessId);
      if (card) {
        businessItems.push({ business: card, followedAt: row.followedAt.toISOString() });
      }
    }
    const userCards = await this.repo.findUserCards(userRows.map((r) => r.userId));
    const userCardById = new Map(userCards.map((c) => [c.id, c]));
    const userItems: FollowedUser[] = [];
    for (const row of userRows) {
      const card = userCardById.get(row.userId);
      if (card) {
        userItems.push(this.toFollowedUser(card, row.followedAt.toISOString()));
      }
    }
    return { users: userItems, businesses: businessItems };
  }

  // ─── feed ─────────────────────────────────────────────────────────────────

  /** GET /feed — the home feed over the caller's followed users + businesses. */
  async feed(followerId: string, query: FeedQuery): Promise<FeedResult> {
    const [businessRows, userRows] = await Promise.all([
      this.repo.listFollowedBusinessRows(followerId),
      this.repo.listFollowedUserRows(followerId),
    ]);
    const { rows, total } = await this.repo.feedPage({
      followedUserIds: userRows.map((r) => r.userId),
      followedBusinessIds: businessRows.map((r) => r.businessId),
      type: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: rows.map((row) => this.toFeedItem(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async assertUnderFollowCap(followerId: string): Promise<void> {
    const total = await this.repo.countFollowsByFollower(followerId);
    if (total >= FOLLOW_MAX_PER_USER) {
      throw ruleException('Too many follows', {
        reason: 'max_follows',
        max: FOLLOW_MAX_PER_USER,
      });
    }
  }

  private toFollowedUser(card: UserCard, followedAt: string): FollowedUser {
    return {
      id: card.id,
      username: card.username,
      displayName: card.displayName,
      avatarUrl:
        this.mediaUrls.urlForMedia({
          key: card.avatarMediaKey ?? '',
          thumbKey: card.avatarMediaThumbKey,
        }) ?? null,
      followedAt,
    };
  }

  private toFeedItem(row: {
    id: string;
    type: FeedItem['type'];
    subjectId: string | null;
    createdAt: Date;
    actorId: string;
    actorUsername: string;
    actorDisplayName: string | null;
    actorAvatarMediaKey: string | null;
    actorAvatarMediaThumbKey: string | null;
    businessId: string | null;
    businessSlug: string | null;
    businessName: string | null;
  }): FeedItem {
    return {
      id: row.id,
      type: row.type,
      actor: {
        id: row.actorId,
        username: row.actorUsername,
        displayName: row.actorDisplayName,
        avatarUrl:
          this.mediaUrls.urlForMedia({
            key: row.actorAvatarMediaKey ?? '',
            thumbKey: row.actorAvatarMediaThumbKey,
          }) ?? null,
      },
      business:
        row.businessId && row.businessSlug && row.businessName
          ? { id: row.businessId, slug: row.businessSlug, name: row.businessName }
          : null,
      subjectId: row.subjectId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private emitFollowed(followerId: string, kind: 'user' | 'business', targetId: string): void {
    this.emitter.emit(FOLLOWS_EVENTS.followed, { followerId, kind, targetId });
  }

  private emitUnfollowed(followerId: string, kind: 'user' | 'business', targetId: string): void {
    this.emitter.emit(FOLLOWS_EVENTS.unfollowed, { followerId, kind, targetId });
  }
}
