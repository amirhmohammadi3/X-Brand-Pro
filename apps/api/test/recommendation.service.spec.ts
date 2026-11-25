import { describe, expect, it, vi } from 'vitest';
import {
  RecommendationService,
  buildProfile,
  groupAttributes,
  popularityScore,
  scoreCandidate,
  summaryFromProfile,
} from '../src/modules/ai/recommendation.service.js';
import type {
  BusinessAttributeRow,
  CandidateBusinessRow,
  InteractedBusinessRow,
  RecommendationRepositoryLike,
} from '../src/modules/ai/recommendation.repository.js';
import type { AiService } from '../src/modules/ai/ai.service.js';
import type { AiCompletionResult } from '@app/contracts';
import type { SettingsService } from '../src/modules/settings/settings.service.js';
import type { CacheService } from '../src/redis/cache.service.js';

/**
 * A9.5 — RecommendationService. The pure ranking helpers (buildProfile,
 * scoreCandidate, popularityScore, groupAttributes, summaryFromProfile) are
 * tested directly; the service is tested through RecommendationRepositoryLike
 * + AiService + CacheService fakes (no DB, no Redis, no LLM).
 */

const UID = '00000000-0000-4000-8000-0000000000u1';
const C1 = '00000000-0000-4000-8000-000000000c1';
const C2 = '00000000-0000-4000-8000-000000000c2';
const CAT_FOOD = '00000000-0000-4000-8000-00000000cafe1';
const CAT_CAFE = '00000000-0000-4000-8000-00000000cafe2';
const AM_WIFI = '00000000-0000-4000-8000-0000000000am1';

// ─── pure helpers ──────────────────────────────────────────────────────────

describe('buildProfile (A9.5 pure)', () => {
  it('aggregates category/amenity/city weights from interactions', () => {
    const interacted: InteractedBusinessRow[] = [
      { businessId: 'B1', cityId: C1, weight: 1 }, // 5-star review
      { businessId: 'B2', cityId: C1, weight: 1 }, // favorite
      { businessId: 'B3', cityId: C2, weight: 0.4 }, // 2-star review
    ];
    const attrs: BusinessAttributeRow[] = [
      { businessId: 'B1', kind: 'category', refId: CAT_FOOD },
      { businessId: 'B1', kind: 'amenity', refId: AM_WIFI },
      { businessId: 'B2', kind: 'category', refId: CAT_FOOD },
      { businessId: 'B3', kind: 'category', refId: CAT_CAFE },
    ];
    const profile = buildProfile(interacted, attrs);
    expect(profile.categoryWeights.get(CAT_FOOD)).toBe(2);
    expect(profile.categoryWeights.get(CAT_CAFE)).toBeCloseTo(0.4);
    expect(profile.amenityWeights.get(AM_WIFI)).toBe(1);
    expect(profile.cityWeights.get(C1)).toBe(2);
    expect(profile.cityWeights.get(C2)).toBeCloseTo(0.4);
    expect(profile.topCityId).toBe(C1);
    expect(profile.interactionCount).toBe(3);
    expect([...profile.interactedIds]).toEqual(expect.arrayContaining(['B1', 'B2', 'B3']));
  });

  it('returns an empty profile on cold start', () => {
    const profile = buildProfile([], []);
    expect(profile.interactionCount).toBe(0);
    expect(profile.topCityId).toBeNull();
    expect(profile.categoryWeights.size).toBe(0);
  });
});

describe('scoreCandidate (A9.5 pure)', () => {
  const profile = buildProfile(
    [
      { businessId: 'B1', cityId: C1, weight: 1 },
      { businessId: 'B2', cityId: C1, weight: 1 },
      { businessId: 'B3', cityId: C2, weight: 0.4 },
    ],
    [
      { businessId: 'B1', kind: 'category', refId: CAT_FOOD },
      { businessId: 'B1', kind: 'amenity', refId: AM_WIFI },
      { businessId: 'B2', kind: 'category', refId: CAT_FOOD },
      { businessId: 'B3', kind: 'category', refId: CAT_CAFE },
    ],
  );

  it('scores a full-match candidate highest (category + amenity + city + popular)', () => {
    const score = scoreCandidate(
      { avgRating: 4.5, reviewCount: 100, cityId: C1 },
      [CAT_FOOD],
      [AM_WIFI],
      profile,
    );
    expect(score).toBeGreaterThan(0.85);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores a partial-match candidate lower than a full match', () => {
    const full = scoreCandidate(
      { avgRating: 4.5, reviewCount: 100, cityId: C1 },
      [CAT_FOOD],
      [AM_WIFI],
      profile,
    );
    const partial = scoreCandidate(
      { avgRating: 5, reviewCount: 10, cityId: C1 },
      [CAT_FOOD],
      [],
      profile,
    );
    expect(full).toBeGreaterThan(partial);
  });

  it('scores a no-match candidate by popularity only (still low)', () => {
    const noMatch = scoreCandidate(
      { avgRating: 3, reviewCount: 2, cityId: C2 },
      [CAT_CAFE],
      [],
      profile,
    );
    // CAT_CAFE has a tiny weight (0.4) so the category contributes a little,
    // but city + amenity are zero — the result must be below the full match.
    expect(noMatch).toBeLessThan(0.2);
  });

  it('falls back to popularity on a cold-start profile', () => {
    const cold = buildProfile([], []);
    const score = scoreCandidate(
      { avgRating: 5, reviewCount: 1000, cityId: C1 },
      [CAT_FOOD],
      [AM_WIFI],
      cold,
    );
    // Cold start → popularity only: 1.0 rating * capped volume.
    expect(score).toBeCloseTo(popularityScore(5, 1000));
  });
});

describe('popularityScore (A9.5 pure)', () => {
  it('is 0 for a business with no reviews', () => {
    expect(popularityScore(5, 0)).toBe(0);
  });
  it('stays within [0,1]', () => {
    expect(popularityScore(5, 1_000_000)).toBeLessThanOrEqual(1);
    expect(popularityScore(0, 0)).toBe(0);
  });
});

describe('groupAttributes + summaryFromProfile (A9.5 pure)', () => {
  it('groups flat rows by business into { categories, amenities }', () => {
    const grouped = groupAttributes([
      { businessId: 'B1', kind: 'category', refId: CAT_FOOD },
      { businessId: 'B1', kind: 'amenity', refId: AM_WIFI },
      { businessId: 'B2', kind: 'category', refId: CAT_CAFE },
    ]);
    expect(grouped.get('B1')).toEqual({ categories: [CAT_FOOD], amenities: [AM_WIFI] });
    expect(grouped.get('B2')).toEqual({ categories: [CAT_CAFE], amenities: [] });
    expect(grouped.get('B3')).toBeUndefined();
  });

  it('summary caps top categories to 3 and exposes the top city', () => {
    const profile = buildProfile(
      [
        { businessId: 'B1', cityId: C1, weight: 1 },
        { businessId: 'B2', cityId: C1, weight: 1 },
        { businessId: 'B3', cityId: C2, weight: 0.4 },
      ],
      [
        { businessId: 'B1', kind: 'category', refId: CAT_FOOD },
        { businessId: 'B2', kind: 'category', refId: CAT_FOOD },
        { businessId: 'B3', kind: 'category', refId: CAT_CAFE },
      ],
    );
    const summary = summaryFromProfile(profile);
    expect(summary.interactionCount).toBe(3);
    expect(summary.topCityId).toBe(C1);
    expect(summary.topCategories).toHaveLength(2);
    expect(summary.topCategories[0]).toEqual({ categoryId: CAT_FOOD, weight: 2 });
  });
});

// ─── service (fakes) ───────────────────────────────────────────────────────

function makeFakeSettings(map: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    'ai.prompts.recommendation.system': 'You explain recommendations in Persian.',
    ...map,
  };
  return {
    get<T>(key: string): Promise<T> {
      return Promise.resolve(base[key] as T);
    },
  } as unknown as SettingsService;
}

function makeFakeCache() {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): Promise<T | null> {
      return Promise.resolve((store.get(key) as T) ?? null);
    },
    set(key: string, value: unknown): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    del(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    _store: store,
  } as unknown as CacheService & { _store: Map<string, unknown> };
}

function makeFakeRepo(opts: {
  interacted?: InteractedBusinessRow[];
  attributes?: BusinessAttributeRow[];
  candidates?: CandidateBusinessRow[];
}) {
  const findInteracted = vi.fn(async () => opts.interacted ?? []);
  const findAttributes = vi.fn(async () => opts.attributes ?? []);
  const findCandidates = vi.fn(
    async (_o: { excludeIds: string[]; cityId?: string; limit: number }) => opts.candidates ?? [],
  );
  return {
    findInteracted,
    findAttributes,
    findCandidates,
  } as unknown as RecommendationRepositoryLike & {
    findInteracted: ReturnType<typeof vi.fn>;
    findAttributes: ReturnType<typeof vi.fn>;
    findCandidates: ReturnType<typeof vi.fn>;
  };
}

function makeFakeAi(result: Partial<AiCompletionResult> = {}): AiService {
  const complete = vi.fn().mockResolvedValue({
    ok: true,
    driver: 'rule',
    model: 'rule-fa-v1',
    text: 'چون به کافه‌های دارای وای‌فای علاقه دارید.',
    promptTokens: 20,
    completionTokens: 10,
    latencyMs: 1,
    errorCode: null,
    errorMessage: null,
    ...result,
  });
  return {
    complete,
    test: async () => ({}) as never,
    getConfig: async () => ({}) as never,
    listCalls: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
  } as unknown as AiService & { complete: ReturnType<typeof vi.fn> };
}

const ATTRS_ALL: BusinessAttributeRow[] = [
  { businessId: 'B1', kind: 'category', refId: CAT_FOOD },
  { businessId: 'B1', kind: 'amenity', refId: AM_WIFI },
  { businessId: 'B2', kind: 'category', refId: CAT_FOOD },
  { businessId: 'B3', kind: 'category', refId: CAT_CAFE },
  { businessId: 'CAND_A', kind: 'category', refId: CAT_FOOD },
  { businessId: 'CAND_A', kind: 'amenity', refId: AM_WIFI },
  { businessId: 'CAND_B', kind: 'category', refId: CAT_CAFE },
  { businessId: 'CAND_C', kind: 'category', refId: CAT_FOOD },
];

const CANDIDATES: CandidateBusinessRow[] = [
  {
    id: 'CAND_A',
    slug: 'cafe-a',
    name: 'کافه آ',
    cityId: C1,
    primaryCategoryId: CAT_FOOD,
    avgRating: '4.5',
    reviewCount: 100,
  },
  {
    id: 'CAND_C',
    slug: 'cafe-c',
    name: 'کافه سی',
    cityId: C1,
    primaryCategoryId: CAT_FOOD,
    avgRating: '5',
    reviewCount: 10,
  },
  {
    id: 'CAND_B',
    slug: 'cafe-b',
    name: 'کافه ب',
    cityId: C2,
    primaryCategoryId: CAT_CAFE,
    avgRating: '3',
    reviewCount: 2,
  },
];

function makeService(
  opts: {
    interacted?: InteractedBusinessRow[];
    aiResult?: Partial<AiCompletionResult>;
  } = {},
) {
  const settings = makeFakeSettings();
  const cache = makeFakeCache();
  const repo = makeFakeRepo({
    interacted: opts.interacted ?? [
      { businessId: 'B1', cityId: C1, weight: 1 },
      { businessId: 'B2', cityId: C1, weight: 1 },
      { businessId: 'B3', cityId: C2, weight: 0.4 },
    ],
    attributes: ATTRS_ALL,
    candidates: CANDIDATES,
  });
  const ai = makeFakeAi(opts.aiResult ?? {});
  const service = new RecommendationService(settings, cache, repo, ai);
  return { service, settings, cache, repo, ai };
}

describe('RecommendationService.getRecommendations (A9.5)', () => {
  it('ranks candidates by similarity and paginates', async () => {
    const { service } = makeService();
    const result = await service.getRecommendations(UID, {});
    // CAND_A (full match) > CAND_C (cat + city, no amenity) > CAND_B (weak).
    expect(result.items.map((i) => i.businessId)).toEqual(['CAND_A', 'CAND_C', 'CAND_B']);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    // The top item has the highest score.
    expect(result.items[0]!.score).toBeGreaterThan(result.items[2]!.score);
  });

  it('exposes the profile summary (interaction count, top city, top categories)', async () => {
    const { service } = makeService();
    const result = await service.getRecommendations(UID, {});
    expect(result.profile.interactionCount).toBe(3);
    expect(result.profile.topCityId).toBe(C1);
    expect(result.profile.topCategories[0]).toEqual({ categoryId: CAT_FOOD, weight: 2 });
  });

  it('excludes the user’s interacted businesses (passes them to the repo)', async () => {
    const { service, repo } = makeService();
    await service.getRecommendations(UID, {});
    const opts = repo.findCandidates.mock.calls[0]![0];
    expect(opts.excludeIds).toEqual(expect.arrayContaining(['B1', 'B2', 'B3']));
    // Scope defaults to the user’s top city when no explicit cityId is given.
    expect(opts.cityId).toBe(C1);
  });

  it('leaves reason null when explain is not requested', async () => {
    const { service, ai } = makeService();
    const result = await service.getRecommendations(UID, {});
    expect(result.items[0]!.reason).toBeNull();
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('attaches an LLM reason to the page’s top item only when explain=true', async () => {
    const { service, ai } = makeService();
    const result = await service.getRecommendations(UID, { explain: true });
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(result.items[0]!.reason).toBe('چون به کافه‌های دارای وای‌فای علاقه دارید.');
    expect(result.items[1]!.reason).toBeNull();
    expect(result.items[2]!.reason).toBeNull();
  });

  it('fails soft (reason null) when the LLM is disabled / errors', async () => {
    const { service, ai } = makeService({
      aiResult: { ok: false, text: null, errorCode: 'AI_DISABLED', errorMessage: 'disabled' },
    });
    const result = await service.getRecommendations(UID, { explain: true });
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(result.items[0]!.reason).toBeNull();
    // The list itself is unaffected.
    expect(result.items).toHaveLength(3);
  });

  it('cold start: ranks by popularity with an empty profile + skips explain', async () => {
    const { service, ai } = makeService({ interacted: [] });
    const result = await service.getRecommendations(UID, { explain: true });
    expect(result.profile.interactionCount).toBe(0);
    expect(result.profile.topCityId).toBeNull();
    expect(result.profile.topCategories).toEqual([]);
    // CAND_A (avg 4.5, 100 reviews) is more popular than CAND_C (avg 5, 10 reviews)
    // because volume dominates at low review counts → A first.
    expect(result.items[0]!.businessId).toBe('CAND_A');
    // No profile → explain is skipped (no LLM call).
    expect(ai.complete).not.toHaveBeenCalled();
    expect(result.items[0]!.reason).toBeNull();
  });

  it('caches the scored pool (the repo is not re-queried on the second call)', async () => {
    const { service, repo } = makeService();
    await service.getRecommendations(UID, {});
    const callsAfterFirst = repo.findCandidates.mock.calls.length;
    await service.getRecommendations(UID, {});
    expect(repo.findCandidates.mock.calls.length).toBe(callsAfterFirst);
  });

  it('honors pageSize + page (paginates the ranked pool)', async () => {
    const { service } = makeService();
    const page1 = await service.getRecommendations(UID, { pageSize: 2, page: 1 });
    const page2 = await service.getRecommendations(UID, { pageSize: 2, page: 2 });
    expect(page1.items.map((i) => i.businessId)).toEqual(['CAND_A', 'CAND_C']);
    expect(page2.items.map((i) => i.businessId)).toEqual(['CAND_B']);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
  });
});
