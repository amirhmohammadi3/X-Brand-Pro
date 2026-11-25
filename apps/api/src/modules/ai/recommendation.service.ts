import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiRecommendationItem,
  AiRecommendationProfileSummary,
  AiRecommendationQuery,
  AiRecommendationResult,
} from '@app/contracts';
// SettingsService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
// CacheService is constructor-injected (global, no module import needed).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import {
  CANDIDATE_POOL_SIZE,
  RECOMMENDATION_REPOSITORY,
  type BusinessAttributeRow,
  type InteractedBusinessRow,
  type RecommendationRepositoryLike,
} from './recommendation.repository.js';
// AiService is constructor-injected.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AiService } from './ai.service.js';

/** Cache TTL for the scored candidate pool (60s — cheap to recompute, burst-safe). */
const CACHE_TTL_SEC = 60;
/** Default + max page size for the recommendation list. */
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/** Scoring weights (sum to 1.0). The category match dominates; popularity breaks ties. */
const W_CATEGORY = 0.45;
const W_AMENITY = 0.2;
const W_CITY = 0.15;
const W_POPULARITY = 0.2;

/** A scored candidate (the cached ranked pool entry). */
interface ScoredCandidate {
  id: string;
  slug: string;
  name: string;
  cityId: string | null;
  primaryCategoryId: string | null;
  avgRating: number;
  reviewCount: number;
  score: number;
  categories: string[];
  amenities: string[];
}

/** The user's affinity profile (built from their interactions). */
export interface UserProfile {
  categoryWeights: Map<string, number>;
  amenityWeights: Map<string, number>;
  cityWeights: Map<string, number>;
  interactedIds: Set<string>;
  topCityId: string | null;
  interactionCount: number;
}

/** The cached scored-pool value (ranked list + the profile summary). */
interface ScoredPool {
  ranked: ScoredCandidate[];
  summary: AiRecommendationProfileSummary;
}

/**
 * RecommendationService (A9.5) — personalized business recommendations.
 *
 * The ranking is RULE-BASED (no LLM): it builds a user affinity profile from
 * the businesses the user has reviewed (approved) or favorited — category,
 * amenity and city weights, weighted by the review rating (a 5-star review
 * counts more than a 2-star one) — then scores every active candidate by
 * similarity to that profile. The optional `?explain=true` asks the LLM for a
 * one-sentence Persian rationale for the page's top result (gated by
 * `ai.feature.recommendationsEnabled` through AiService.complete, so a
 * disabled/AI-less install just gets a null reason — the ranking still works).
 *
 * Cold start (no interactions): the ranking falls back to popularity
 * (avg_rating × log(review_count)), so a brand-new user still gets a useful
 * list; the LLM explanation is skipped on a cold-start profile (nothing
 * personal to explain).
 *
 * The scored candidate pool + profile summary are cached 60s (per user + city
 * scope); pagination + the optional explanation are computed per request from
 * the cached pool.
 */
@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    @Inject(RECOMMENDATION_REPOSITORY) private readonly repo: RecommendationRepositoryLike,
    private readonly ai: AiService,
  ) {}

  async getRecommendations(
    userId: string,
    query: AiRecommendationQuery,
  ): Promise<AiRecommendationResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const { ranked, summary } = await this.getScoredPool(userId, query.cityId);

    const total = ranked.length;
    const start = (page - 1) * pageSize;
    const pageItems = ranked.slice(start, start + pageSize);

    // Optional LLM explanation for the page's top item (one call, fail-soft).
    let topReason: string | null = null;
    if (query.explain === true && pageItems.length > 0) {
      const profile = await this.loadProfile(userId);
      topReason = await this.explain(pageItems[0]!, profile);
    }

    const items: AiRecommendationItem[] = pageItems.map((c, idx) => ({
      businessId: c.id,
      slug: c.slug,
      name: c.name,
      cityId: c.cityId,
      primaryCategoryId: c.primaryCategoryId,
      avgRating: c.avgRating,
      reviewCount: c.reviewCount,
      score: c.score,
      // The reason attaches only to the page's top item.
      reason: idx === 0 ? topReason : null,
    }));

    return { items, page, pageSize, total, profile: summary };
  }

  // ─── scored pool (cached) ───────────────────────────────────────────────

  private async getScoredPool(userId: string, cityId?: string): Promise<ScoredPool> {
    const key = `ai:rec:ranked:${userId}:${cityId ?? 'all'}`;
    const cached = await this.cache.get<ScoredPool>(key);
    if (cached) return cached;

    const profile = await this.loadProfile(userId);
    const summary = summaryFromProfile(profile);
    const scopeCityId = cityId ?? profile.topCityId ?? undefined;

    const candidates = await this.repo.findCandidates({
      excludeIds: [...profile.interactedIds],
      cityId: scopeCityId,
      limit: CANDIDATE_POOL_SIZE,
    });
    const candidateAttrs = await this.repo.findAttributes(candidates.map((c) => c.id));
    const grouped = groupAttributes(candidateAttrs);

    const ranked: ScoredCandidate[] = candidates.map((c) => {
      const attrs = grouped.get(c.id) ?? { categories: [], amenities: [] };
      const avgRating = parseAvgRating(c.avgRating);
      const score = scoreCandidate(
        { avgRating, reviewCount: c.reviewCount, cityId: c.cityId },
        attrs.categories,
        attrs.amenities,
        profile,
      );
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        cityId: c.cityId,
        primaryCategoryId: c.primaryCategoryId,
        avgRating,
        reviewCount: c.reviewCount,
        score,
        categories: attrs.categories,
        amenities: attrs.amenities,
      };
    });
    // Sort by score desc; tiebreak by review_count then avg_rating (stable,
    // deterministic — never rely on DB row order for the user-facing list).
    ranked.sort(
      (a, b) => b.score - a.score || b.reviewCount - a.reviewCount || b.avgRating - a.avgRating,
    );

    const value: ScoredPool = { ranked, summary };
    await this.cache.set(key, value, CACHE_TTL_SEC);
    return value;
  }

  // ─── profile ────────────────────────────────────────────────────────────

  private async loadProfile(userId: string): Promise<UserProfile> {
    const interacted = await this.repo.findInteracted(userId);
    const ids = [...new Set(interacted.map((i) => i.businessId))];
    const attrs = await this.repo.findAttributes(ids);
    return buildProfile(interacted, attrs);
  }

  // ─── LLM explanation (optional, fail-soft) ──────────────────────────────

  private async explain(candidate: ScoredCandidate, profile: UserProfile): Promise<string | null> {
    // Nothing personal to explain on a cold-start profile.
    if (profile.interactionCount === 0) return null;

    const systemPrompt = await this.settings.get<string>('ai.prompts.recommendation.system');
    const topCats = [...profile.categoryWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)
      .join('، ');
    const topAmens = [...profile.amenityWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)
      .join('، ');

    const userPrompt = [
      `کسب‌وکار پیشنهادشده: ${candidate.name}`,
      `دستهٔ اصلی: ${candidate.primaryCategoryId ?? 'نامشخص'}`,
      `شهر: ${candidate.cityId ?? 'نامشخص'}`,
      `علایق کاربر — دسته‌ها: ${topCats || 'نامشخص'}`,
      `علایق کاربر — امکانات: ${topAmens || 'نامشخص'}`,
      `امتیاز شباهت: ${round2(candidate.score)}`,
    ].join('\n');

    const req: AiCompletionRequest = {
      feature: 'recommendation',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 80,
      temperature: 0.5,
    };

    try {
      const result = await this.ai.complete(req);
      if (result.ok && result.text && result.text.trim().length > 0) {
        return result.text.trim();
      }
      return null;
    } catch (err) {
      // Fail-soft: a driver outage or a disabled feature never breaks the list.
      this.logger.warn(
        `recommendation explanation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

// ─── pure helpers (exported for unit tests) ────────────────────────────────

/**
 * Build a user affinity profile from their interacted businesses + the
 * category/amenity attributes of those businesses. Each interaction's weight
 * (review rating/5, or 1 for a favorite) is added to every category/amenity/
 * city the business carries.
 */
export function buildProfile(
  interacted: InteractedBusinessRow[],
  attributes: BusinessAttributeRow[],
): UserProfile {
  const attrsByBusiness = groupAttributes(attributes);
  const categoryWeights = new Map<string, number>();
  const amenityWeights = new Map<string, number>();
  const cityWeights = new Map<string, number>();
  const interactedIds = new Set<string>();

  for (const row of interacted) {
    interactedIds.add(row.businessId);
    const attrs = attrsByBusiness.get(row.businessId);
    if (attrs) {
      for (const cat of attrs.categories) {
        categoryWeights.set(cat, (categoryWeights.get(cat) ?? 0) + row.weight);
      }
      for (const amt of attrs.amenities) {
        amenityWeights.set(amt, (amenityWeights.get(amt) ?? 0) + row.weight);
      }
    }
    if (row.cityId) {
      cityWeights.set(row.cityId, (cityWeights.get(row.cityId) ?? 0) + row.weight);
    }
  }

  return {
    categoryWeights,
    amenityWeights,
    cityWeights,
    interactedIds,
    topCityId: topKey(cityWeights),
    interactionCount: interactedIds.size,
  };
}

/**
 * Score a candidate business against the user profile (0..1). A weighted blend
 * of category affinity, amenity overlap, city match and popularity. On a
 * cold-start profile (no interactions) the score is popularity only.
 */
export function scoreCandidate(
  candidate: { avgRating: number; reviewCount: number; cityId: string | null },
  categories: string[],
  amenities: string[],
  profile: UserProfile,
): number {
  const popularity = popularityScore(candidate.avgRating, candidate.reviewCount);
  if (profile.interactionCount === 0) {
    return clamp01(popularity);
  }
  const totalCat = sumValues(profile.categoryWeights);
  const matchedCat = categories.reduce((acc, c) => acc + (profile.categoryWeights.get(c) ?? 0), 0);
  const categoryScore = totalCat > 0 ? matchedCat / totalCat : 0;

  const totalAmt = sumValues(profile.amenityWeights);
  const matchedAmt = amenities.reduce((acc, a) => acc + (profile.amenityWeights.get(a) ?? 0), 0);
  const amenityScore = totalAmt > 0 ? matchedAmt / totalAmt : 0;

  const cityScore = profile.topCityId !== null && candidate.cityId === profile.topCityId ? 1 : 0;

  const score =
    W_CATEGORY * categoryScore +
    W_AMENITY * amenityScore +
    W_CITY * cityScore +
    W_POPULARITY * popularity;
  return clamp01(score);
}

/** Popularity 0..1: avg_rating/5 scaled by log(review_count+1) (capped at 1). */
export function popularityScore(avgRating: number, reviewCount: number): number {
  const rating = clamp01(avgRating / 5);
  const volume = Math.min(1, Math.log10(reviewCount + 1) / 2);
  return clamp01(rating * volume);
}

/** Group flat attribute rows by business → { categories, amenities }. */
export function groupAttributes(
  rows: BusinessAttributeRow[],
): Map<string, { categories: string[]; amenities: string[] }> {
  const out = new Map<string, { categories: string[]; amenities: string[] }>();
  for (const r of rows) {
    let entry = out.get(r.businessId);
    if (!entry) {
      entry = { categories: [], amenities: [] };
      out.set(r.businessId, entry);
    }
    if (r.kind === 'category') entry.categories.push(r.refId);
    else entry.amenities.push(r.refId);
  }
  return out;
}

/** Build the transparency summary from a resolved profile. */
export function summaryFromProfile(profile: UserProfile): AiRecommendationProfileSummary {
  const topCategories = [...profile.categoryWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoryId, weight]) => ({ categoryId, weight: round2(weight) }));
  return {
    interactionCount: profile.interactionCount,
    topCategories,
    topCityId: profile.topCityId,
  };
}

// ─── small utils ───────────────────────────────────────────────────────────

function topKey(weights: Map<string, number>): string | null {
  let best: string | null = null;
  let bestW = -1;
  for (const [k, w] of weights) {
    if (w > bestW) {
      bestW = w;
      best = k;
    }
  }
  return best;
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse the numeric-column string (Drizzle returns numeric columns as strings). */
function parseAvgRating(raw: string): number {
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}
