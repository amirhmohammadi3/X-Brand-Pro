import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { mediaFiles } from '../../db/schema/media.js';
import { users } from '../../db/schema/users.js';
import { activityEvents, follows } from '../../db/schema/follows.js';
import type { ActivityType } from '@app/contracts';

/** DI token for the follows repository (tests bind a fake). */
export const FOLLOWS_REPOSITORY = Symbol('FOLLOWS_REPOSITORY');

/** A follow row (the follower + target kind are the interesting bits). */
export interface FollowMeta {
  id: string;
  followerId: string;
  businessId: string | null;
  userId: string | null;
  createdAt: Date;
}

/** GET /follows/me business slice: the id + when (cards come from the business module). */
export interface FollowedBusinessRow {
  businessId: string;
  followedAt: Date;
}

/** GET /follows/me user slice: the id + when (cards come from the users join). */
export interface FollowedUserRow {
  userId: string;
  followedAt: Date;
}

/** A user card as the follows/feed reads serve it (avatar resolved by URL service). */
export interface UserCard {
  id: string;
  username: string;
  displayName: string | null;
  avatarMediaKey: string | null;
  avatarMediaThumbKey: string | null;
}

/** One joined feed row — everything the DTO needs before URL resolution. */
export interface FeedRow {
  id: string;
  type: ActivityType;
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
}

export interface FeedPage {
  rows: FeedRow[];
  total: number;
}

/**
 * The narrow fake-able surface consumed by FollowsService + the activity
 * subscriber + the HTTP layer. Uniqueness races (23505 on
 * `follows_business_unq` / `follows_user_unq`) map to `null` HERE so the
 * service answers a clean 409 without pg error internals.
 */
export interface FollowsRepositoryLike {
  /** Existence + lifecycle of a business (404-never-leak, mirrors B5.1). */
  findBusinessContext(businessId: string): Promise<{
    status: string;
    deletedAt: Date | null;
  } | null>;
  /** Existence + status of a user target (the B4.10 visibility rule). */
  findUserContext(userId: string): Promise<{ status: string } | null>;
  insertFollow(input: {
    followerId: string;
    businessId?: string | null;
    userId?: string | null;
  }): Promise<FollowMeta | null>;
  findFollowByBusiness(followerId: string, businessId: string): Promise<FollowMeta | null>;
  findFollowByUser(followerId: string, userId: string): Promise<FollowMeta | null>;
  deleteFollow(followId: string): Promise<void>;
  countFollowsByFollower(followerId: string): Promise<number>;
  /** GET /follows/me slices — newest follows first, active targets only. */
  listFollowedBusinessRows(followerId: string): Promise<FollowedBusinessRow[]>;
  listFollowedUserRows(followerId: string): Promise<FollowedUserRow[]>;
  /** The card the user slice renders (B4.10 identity columns + avatar keys). */
  findUserCards(userIds: string[]): Promise<UserCard[]>;
  // ─── activity feed ────────────────────────────────────────────────────
  /** Best-effort append (the subscriber swallows failures — never break the source write). */
  insertActivityEvent(input: {
    actorId: string;
    type: ActivityType;
    businessId: string | null;
    subjectId: string | null;
  }): Promise<void>;
  /** The delete-on-source-event lookup: retract every row for (type, subject). */
  deleteActivityEventsBy(type: ActivityType, subjectId: string): Promise<void>;
  /** The re-approval path: insert only when the row is missing (idempotent). */
  ensureActivityEvent(input: {
    actorId: string;
    type: ActivityType;
    businessId: string | null;
    subjectId: string | null;
  }): Promise<void>;
  /** The home feed page: joined actors/businesses, `active` actors only. */
  feedPage(input: {
    followedUserIds: string[];
    followedBusinessIds: string[];
    type?: ActivityType;
    page: number;
    pageSize: number;
  }): Promise<FeedPage>;
}

@Injectable()
export class FollowsRepository implements FollowsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(businessId: string): Promise<{
    status: string;
    deletedAt: Date | null;
  } | null> {
    const rows = await this.client.db
      .select({ status: businesses.status, deletedAt: businesses.deletedAt })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserContext(userId: string): Promise<{ status: string } | null> {
    const rows = await this.client.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertFollow(input: {
    followerId: string;
    businessId?: string | null;
    userId?: string | null;
  }): Promise<FollowMeta | null> {
    try {
      const rows = await this.client.db
        .insert(follows)
        .values({
          followerId: input.followerId,
          businessId: input.businessId ?? null,
          userId: input.userId ?? null,
        })
        .returning({
          id: follows.id,
          followerId: follows.followerId,
          businessId: follows.businessId,
          userId: follows.userId,
          createdAt: follows.createdAt,
        });
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // already following → 409 upstream
      throw error;
    }
  }

  async findFollowByBusiness(followerId: string, businessId: string): Promise<FollowMeta | null> {
    return this.findFollow(
      and(eq(follows.followerId, followerId), eq(follows.businessId, businessId)) as SQL,
    );
  }

  async findFollowByUser(followerId: string, userId: string): Promise<FollowMeta | null> {
    return this.findFollow(
      and(eq(follows.followerId, followerId), eq(follows.userId, userId)) as SQL,
    );
  }

  async deleteFollow(followId: string): Promise<void> {
    await this.client.db.delete(follows).where(eq(follows.id, followId));
  }

  async countFollowsByFollower(followerId: string): Promise<number> {
    const rows = await this.client.db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followerId, followerId));
    return Number(rows[0]?.value ?? 0);
  }

  async listFollowedBusinessRows(followerId: string): Promise<FollowedBusinessRow[]> {
    const rows = await this.client.db
      .select({ businessId: follows.businessId, followedAt: follows.createdAt })
      .from(follows)
      .innerJoin(businesses, eq(businesses.id, follows.businessId))
      // Active, non-deleted businesses only — a soft-deleted/suspended
      // business stops being followed-content the same way it stops being
      // publicly served (the row itself stays; refollowing is a POST).
      .where(
        and(
          eq(follows.followerId, followerId),
          isNull(businesses.deletedAt),
          eq(businesses.status, 'active'),
        ),
      )
      .orderBy(desc(follows.createdAt));
    return rows.map((r) => ({ businessId: r.businessId as string, followedAt: r.followedAt }));
  }

  async listFollowedUserRows(followerId: string): Promise<FollowedUserRow[]> {
    const rows = await this.client.db
      .select({ userId: follows.userId, followedAt: follows.createdAt })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.userId))
      // The B4.10 visibility rule: blocked/deleted users disappear from the
      // list without any cleanup job.
      .where(and(eq(follows.followerId, followerId), eq(users.status, 'active')))
      .orderBy(desc(follows.createdAt));
    return rows.map((r) => ({ userId: r.userId as string, followedAt: r.followedAt }));
  }

  async findUserCards(userIds: string[]): Promise<UserCard[]> {
    if (userIds.length === 0) return [];
    const rows = await this.client.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarMediaKey: mediaFiles.key,
        avatarMediaThumbKey: mediaFiles.thumbKey,
      })
      .from(users)
      .leftJoin(mediaFiles, eq(mediaFiles.id, users.avatarMediaId))
      .where(inArray(users.id, userIds));
    return rows;
  }

  async insertActivityEvent(input: {
    actorId: string;
    type: ActivityType;
    businessId: string | null;
    subjectId: string | null;
  }): Promise<void> {
    await this.client.db.insert(activityEvents).values({
      actorId: input.actorId,
      type: input.type,
      businessId: input.businessId,
      subjectId: input.subjectId,
    });
  }

  async deleteActivityEventsBy(type: ActivityType, subjectId: string): Promise<void> {
    await this.client.db
      .delete(activityEvents)
      .where(and(eq(activityEvents.type, type), eq(activityEvents.subjectId, subjectId)));
  }

  async ensureActivityEvent(input: {
    actorId: string;
    type: ActivityType;
    businessId: string | null;
    subjectId: string | null;
  }): Promise<void> {
    const existing = await this.client.db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.type, input.type),
          eq(activityEvents.subjectId, input.subjectId as string),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;
    await this.insertActivityEvent(input);
  }

  async feedPage(input: {
    followedUserIds: string[];
    followedBusinessIds: string[];
    type?: ActivityType;
    page: number;
    pageSize: number;
  }): Promise<FeedPage> {
    // OR of the two follow scopes: a row is in the feed when its ACTOR is a
    // followed user OR its BUSINESS is a followed business (an OR row can
    // never duplicate — one row, one membership test).
    const scopes: SQL[] = [];
    if (input.followedUserIds.length > 0) {
      scopes.push(inArray(activityEvents.actorId, input.followedUserIds));
    }
    if (input.followedBusinessIds.length > 0) {
      scopes.push(inArray(activityEvents.businessId, input.followedBusinessIds));
    }
    if (scopes.length === 0) return { rows: [], total: 0 };
    const where = and(
      or(...scopes) as SQL,
      input.type ? eq(activityEvents.type, input.type) : undefined,
    ) as SQL;
    // Inner join on users with the B4.10 visibility rule: blocked/deleted
    // actors vanish from the feed without a cleanup job.
    const joined = this.client.db
      .select({
        id: activityEvents.id,
        type: activityEvents.type,
        subjectId: activityEvents.subjectId,
        createdAt: activityEvents.createdAt,
        actorId: users.id,
        actorUsername: users.username,
        actorDisplayName: users.displayName,
        actorAvatarMediaKey: mediaFiles.key,
        actorAvatarMediaThumbKey: mediaFiles.thumbKey,
        businessId: businesses.id,
        businessSlug: businesses.slug,
        businessName: businesses.name,
      })
      .from(activityEvents)
      .innerJoin(users, and(eq(users.id, activityEvents.actorId), eq(users.status, 'active')))
      .leftJoin(mediaFiles, eq(mediaFiles.id, users.avatarMediaId))
      .leftJoin(businesses, eq(businesses.id, activityEvents.businessId))
      .where(where);
    const [rows, totals] = await Promise.all([
      joined
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      this.client.db
        .select({ value: count() })
        .from(activityEvents)
        .innerJoin(users, and(eq(users.id, activityEvents.actorId), eq(users.status, 'active')))
        .where(where),
    ]);
    return {
      rows: rows as FeedRow[],
      total: Number(totals[0]?.value ?? 0),
    };
  }

  /** Shared single-follow fetch. */
  private async findFollow(where: SQL): Promise<FollowMeta | null> {
    const rows = await this.client.db
      .select({
        id: follows.id,
        followerId: follows.followerId,
        businessId: follows.businessId,
        userId: follows.userId,
        createdAt: follows.createdAt,
      })
      .from(follows)
      .where(where)
      .limit(1);
    return rows[0] ?? null;
  }
}
