import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { mediaFiles } from '../../db/schema/media.js';
import { users } from '../../db/schema/users.js';
import { reviews } from '../../db/schema/reviews.js';
import type { ReviewStatus } from '@app/contracts';

/** DI token for the reviews repository (tests bind a fake). */
export const REVIEWS_REPOSITORY = Symbol('REVIEWS_REPOSITORY');

/** Review row joined with the photo media key + author identity (URL/name resolution in the service). */
export interface ReviewWithMeta {
  id: string;
  businessId: string;
  userId: string;
  authorName: string | null;
  authorUsername: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  photoMediaId: string | null;
  photoKey: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewPage {
  items: ReviewWithMeta[];
  total: number;
}

/** The narrow fake-able surface consumed by ReviewsService + B4.1's HTTP layer. */
export interface ReviewsRepositoryLike {
  /** Existence + status of the business (404-never-leak + active-only rules). */
  findBusinessContext(
    businessId: string,
  ): Promise<{ status: string; deletedAt: Date | null } | null>;
  /** The caller's existing review for the business (one-per-business rule). */
  findByBusinessAndUser(businessId: string, userId: string): Promise<ReviewWithMeta | null>;
  findById(reviewId: string): Promise<ReviewWithMeta | null>;
  /** Approved-only, paginated business list (public). */
  listByBusiness(businessId: string, page: number, pageSize: number): Promise<ReviewPage>;
  /** Every-status list of the caller's own reviews, newest first. */
  listByUser(userId: string, page: number, pageSize: number): Promise<ReviewPage>;
  /** Admin triage list (B4.4 builds on this): explicit status filter. */
  listByStatus(
    businessId: string,
    status: ReviewStatus,
    page: number,
    pageSize: number,
  ): Promise<ReviewPage>;
  insert(input: {
    businessId: string;
    userId: string;
    rating: number;
    body: string;
    photoMediaId: string | null;
  }): Promise<ReviewWithMeta>;
  /** Author edit: rating/body/photo; stamps edited_at + updated_at. */
  update(
    reviewId: string,
    patch: { rating?: number; body?: string; photoMediaId?: string | null },
  ): Promise<ReviewWithMeta | null>;
  delete(reviewId: string): Promise<boolean>;
  /**
   * Recompute the business aggregate from the APPROVED reviews and write it
   * to `businesses` in ONE statement: avg rounded to 2 decimals (the
   * numeric(3,2) column), count as int; zero reviews → 0/0.
   */
  recomputeRating(businessId: string): Promise<{ avgRating: string; reviewCount: number }>;
}

const REVIEW_SELECT = {
  id: reviews.id,
  businessId: reviews.businessId,
  userId: reviews.userId,
  authorName: users.displayName,
  authorUsername: users.username,
  rating: reviews.rating,
  body: reviews.body,
  status: reviews.status,
  photoMediaId: reviews.photoMediaId,
  photoKey: mediaFiles.key,
  editedAt: reviews.editedAt,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
};

/**
 * Reviews persistence (B4.1) over `reviews` (migration 0021). Joins `users`
 * for the denormalised author identity (display name falls back in the UI)
 * and `media_files` for the photo key (URL resolution stays in the service
 * via MediaUrlService). The aggregate write is a single
 * `UPDATE ... SET (SELECT AVG, COUNT ...)` result — one statement, so two
 * concurrent recomputes cannot interleave a stale count over a newer one.
 */
@Injectable()
export class ReviewsRepository implements ReviewsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(
    businessId: string,
  ): Promise<{ status: string; deletedAt: Date | null } | null> {
    const rows = await this.client.db
      .select({ status: businesses.status, deletedAt: businesses.deletedAt })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByBusinessAndUser(businessId: string, userId: string): Promise<ReviewWithMeta | null> {
    const rows = await this.client.db
      .select(REVIEW_SELECT)
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, reviews.photoMediaId))
      .where(and(eq(reviews.businessId, businessId), eq(reviews.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(reviewId: string): Promise<ReviewWithMeta | null> {
    const rows = await this.client.db
      .select(REVIEW_SELECT)
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, reviews.photoMediaId))
      .where(eq(reviews.id, reviewId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Shared list builder: page slice + total count for the same WHERE. */
  private async list(where: SQL | undefined, page: number, pageSize: number): Promise<ReviewPage> {
    const items = await this.client.db
      .select(REVIEW_SELECT)
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, reviews.photoMediaId))
      .where(where)
      .orderBy(desc(reviews.createdAt), asc(reviews.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totals = await this.client.db.select({ n: count() }).from(reviews).where(where);
    return { items, total: totals[0]?.n ?? 0 };
  }

  async listByBusiness(businessId: string, page: number, pageSize: number): Promise<ReviewPage> {
    return this.list(
      and(eq(reviews.businessId, businessId), eq(reviews.status, 'approved')),
      page,
      pageSize,
    );
  }

  async listByStatus(
    businessId: string,
    status: ReviewStatus,
    page: number,
    pageSize: number,
  ): Promise<ReviewPage> {
    return this.list(
      and(eq(reviews.businessId, businessId), eq(reviews.status, status)),
      page,
      pageSize,
    );
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<ReviewPage> {
    return this.list(eq(reviews.userId, userId), page, pageSize);
  }

  async insert(input: {
    businessId: string;
    userId: string;
    rating: number;
    body: string;
    photoMediaId: string | null;
  }): Promise<ReviewWithMeta> {
    const inserted = await this.client.db
      .insert(reviews)
      .values({
        businessId: input.businessId,
        userId: input.userId,
        rating: input.rating,
        body: input.body,
        photoMediaId: input.photoMediaId,
      })
      .returning({ id: reviews.id });
    const row = inserted[0];
    if (!row) throw new Error('reviews insert returned no rows');
    const created = await this.findById(row.id);
    if (!created) throw new Error('reviews insert vanished');
    return created;
  }

  async update(
    reviewId: string,
    patch: { rating?: number; body?: string; photoMediaId?: string | null },
  ): Promise<ReviewWithMeta | null> {
    await this.client.db
      .update(reviews)
      .set({
        ...patch,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId));
    return this.findById(reviewId);
  }

  async delete(reviewId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(reviews)
      .where(eq(reviews.id, reviewId))
      .returning({ id: reviews.id });
    return deleted.length > 0;
  }

  async recomputeRating(businessId: string): Promise<{ avgRating: string; reviewCount: number }> {
    const rows = await this.client.db
      .select({
        avg: sql<string>`coalesce(round(avg(${reviews.rating})::numeric, 2), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.businessId, businessId), eq(reviews.status, 'approved')));
    const agg = rows[0] ?? { avg: '0', n: 0 };
    await this.client.db
      .update(businesses)
      .set({
        avgRating: agg.avg,
        reviewCount: agg.n,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));
    return { avgRating: agg.avg, reviewCount: agg.n };
  }
}
