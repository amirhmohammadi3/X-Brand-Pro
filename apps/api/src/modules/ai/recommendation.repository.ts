import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, not } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  businesses,
  businessAmenities,
  businessCategories,
  favoriteItems,
  reviews,
} from '../../db/schema/index.js';

/** DI token for the recommendation repository (tests bind a fake). */
export const RECOMMENDATION_REPOSITORY = Symbol('RECOMMENDATION_REPOSITORY');

/**
 * A business the user has interacted with (reviewed or favorited). The weight
 * is the interaction strength: a review's rating/5 (0.2..1, so a 1-star review
 * still counts, weakly) or 1 for a favorite (explicit interest, no rating).
 */
export interface InteractedBusinessRow {
  businessId: string;
  cityId: string | null;
  weight: number;
}

/**
 * A flat category/amenity row for a business (one row per (business, ref)).
 * The service groups these by business id; one query serves both the profile
 * build (interacted businesses) and the candidate scoring.
 */
export interface BusinessAttributeRow {
  businessId: string;
  kind: 'category' | 'amenity';
  refId: string;
}

/** A candidate business (active, not soft-deleted). */
export interface CandidateBusinessRow {
  id: string;
  slug: string;
  name: string;
  cityId: string | null;
  primaryCategoryId: string | null;
  /** numeric column → Drizzle returns it as a string; the service parses it. */
  avgRating: string;
  reviewCount: number;
}

/** The narrow fake-able surface (tests bind an in-memory fake). */
export interface RecommendationRepositoryLike {
  /** The businesses the user reviewed (approved) or favorited, with a weight. */
  findInteracted(userId: string): Promise<InteractedBusinessRow[]>;
  /** The category + amenity ids for a set of businesses (flat). */
  findAttributes(businessIds: string[]): Promise<BusinessAttributeRow[]>;
  /** Active, non-deleted businesses (excluding the given ids), optional city scope, capped. */
  findCandidates(opts: {
    excludeIds: string[];
    cityId?: string;
    limit: number;
  }): Promise<CandidateBusinessRow[]>;
}

/** How many candidate businesses the ranking draws from (v1 cap). */
export const CANDIDATE_POOL_SIZE = 500;

/**
 * Drizzle-backed recommendation repository (A9.5). Three read-only queries:
 *  - the user's interacted businesses (approved reviews + favorites) with a
 *    weight (review rating/5, or 1 for a favorite);
 *  - the category + amenity ids for a set of businesses (flat — used both to
 *    build the user profile and to score candidates);
 *  - the active candidate pool (status='active', not soft-deleted, excluding
 *    the businesses the user already interacted with, optional city scope),
 *    ordered by review_count desc then avg_rating desc, capped to
 *    CANDIDATE_POOL_SIZE.
 *
 * No writes, no cross-domain joins beyond the business FK — the service does
 * the affinity math in TypeScript (pure, unit-tested). Repository specs are
 * DB-requiring and self-skip in the sandbox (the established pattern).
 */
@Injectable()
export class RecommendationRepository implements RecommendationRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly drizzle: DrizzleClient) {}

  async findInteracted(userId: string): Promise<InteractedBusinessRow[]> {
    const db = this.drizzle.db;
    const [reviewRows, favoriteRows] = await Promise.all([
      db
        .select({
          businessId: reviews.businessId,
          cityId: businesses.cityId,
          rating: reviews.rating,
        })
        .from(reviews)
        .innerJoin(businesses, eq(reviews.businessId, businesses.id))
        .where(
          and(
            eq(reviews.userId, userId),
            eq(reviews.status, 'approved'),
            isNull(businesses.deletedAt),
          ),
        ),
      db
        .select({ businessId: favoriteItems.businessId, cityId: businesses.cityId })
        .from(favoriteItems)
        .innerJoin(businesses, eq(favoriteItems.businessId, businesses.id))
        .where(and(eq(favoriteItems.userId, userId), isNull(businesses.deletedAt))),
    ]);

    return [
      ...reviewRows.map((r) => ({
        businessId: r.businessId,
        cityId: r.cityId,
        weight: clampWeight(r.rating / 5),
      })),
      ...favoriteRows.map((f) => ({ businessId: f.businessId, cityId: f.cityId, weight: 1 })),
    ];
  }

  async findAttributes(businessIds: string[]): Promise<BusinessAttributeRow[]> {
    if (businessIds.length === 0) return [];
    const db = this.drizzle.db;
    const [catRows, amenityRows] = await Promise.all([
      db
        .select({
          businessId: businessCategories.businessId,
          refId: businessCategories.categoryId,
        })
        .from(businessCategories)
        .where(inArray(businessCategories.businessId, businessIds)),
      db
        .select({
          businessId: businessAmenities.businessId,
          refId: businessAmenities.amenityId,
        })
        .from(businessAmenities)
        .where(inArray(businessAmenities.businessId, businessIds)),
    ]);
    return [
      ...catRows.map((c) => ({
        businessId: c.businessId,
        kind: 'category' as const,
        refId: c.refId,
      })),
      ...amenityRows.map((a) => ({
        businessId: a.businessId,
        kind: 'amenity' as const,
        refId: a.refId,
      })),
    ];
  }

  async findCandidates(opts: {
    excludeIds: string[];
    cityId?: string;
    limit: number;
  }): Promise<CandidateBusinessRow[]> {
    const db = this.drizzle.db;
    return db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        name: businesses.name,
        cityId: businesses.cityId,
        primaryCategoryId: businesses.primaryCategoryId,
        avgRating: businesses.avgRating,
        reviewCount: businesses.reviewCount,
      })
      .from(businesses)
      .where(
        and(
          eq(businesses.status, 'active'),
          isNull(businesses.deletedAt),
          ...(opts.excludeIds.length > 0 ? [not(inArray(businesses.id, opts.excludeIds))] : []),
          ...(opts.cityId ? [eq(businesses.cityId, opts.cityId)] : []),
        ),
      )
      .orderBy(desc(businesses.reviewCount), desc(businesses.avgRating))
      .limit(opts.limit);
  }
}

/** Clamp a review-derived weight into [0.2, 1] (a 1-star review still counts, weakly). */
function clampWeight(w: number): number {
  if (Number.isNaN(w) || w < 0.2) return 0.2;
  if (w > 1) return 1;
  return w;
}
