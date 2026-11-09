import { describe, expect, it, vi } from 'vitest';
import { SuggestService } from '../src/modules/search/suggest.service.js';
import type { SuggestHit, SuggestQuery } from '@app/contracts';

/**
 * B3.3 suggest service — the pieces testable without a live Postgres+PostGIS or
 * Redis are: the prefix normalisation (Persian/Arabic char mapping + digit
 * normalisation + Latin lowercase + SQL-wildcard escape), the cache-key
 * construction (every dimension that changes the result set is in the key), and
 * the `scope=all` merge/dedup/cap. The repository's trigram SQL is integration-
 * tested against Docker per the Follow-up.
 *
 * The fake cache stores values in a Map and never "fails" (the real CacheService
 * degrades to a miss on Redis errors — tested in redis.cache.spec.ts).
 */
function makeService(
  repo: {
    suggestBusinesses: (q: unknown) => Promise<SuggestHit[]>;
    suggestCategories: (q: unknown) => Promise<SuggestHit[]>;
    suggestNeighborhoods: (q: unknown) => Promise<SuggestHit[]>;
    suggestCities: (q: unknown) => Promise<SuggestHit[]>;
  },
  cacheStore = new Map<string, unknown>(),
) {
  const cache = {
    async get<T>(key: string): Promise<T | null> {
      return (cacheStore.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown): Promise<void> {
      cacheStore.set(key, value);
    },
    async del(key: string): Promise<void> {
      cacheStore.delete(key);
    },
    async wrap<T>(key: string, _ttl: number, produce: () => Promise<T>): Promise<T> {
      const cached = cacheStore.get(key);
      if (cached !== undefined) return cached as T;
      const v = await produce();
      cacheStore.set(key, v);
      return v;
    },
  };
  return {
    service: new SuggestService(repo as never, cache as never),
    cacheStore,
  };
}

const baseQuery: SuggestQuery = { q: 'کافه', scope: 'all', limit: 8 };

describe('SuggestService.normalize (B3.3)', () => {
  it('normalises the prefix through normalizePersianText + normalizeDigits + lowercase', () => {
    const { service } = makeService({} as never);
    // Arabic kaf+yeh + Persian digit → canonical Persian + ASCII.
    const out = service.normalize({ ...baseQuery, q: 'كافه ۲' });
    expect(out.prefix).toBe('کافه 2');
  });

  it('escapes SQL-wildcard characters so the ILIKE pattern is literal', () => {
    const { service } = makeService({} as never);
    const out = service.normalize({ ...baseQuery, q: 'ca_fe%test\\x' });
    // % → \%, _ → \_, \ → \\ (backslash escaped first)
    expect(out.prefix).toBe('ca\\_fe\\%test\\\\x');
  });

  it('returns an empty prefix for whitespace-only input (the service skips the query)', () => {
    const { service } = makeService({} as never);
    const out = service.normalize({ ...baseQuery, q: '   ' });
    expect(out.prefix).toBe('');
  });

  it('carries scope, cityId and limit through unchanged', () => {
    const { service } = makeService({} as never);
    const out = service.normalize({
      q: 'تهران',
      scope: 'city',
      cityId: '00000000-0000-0000-0000-000000000001',
      limit: 5,
    });
    expect(out.scope).toBe('city');
    expect(out.cityId).toBe('00000000-0000-0000-0000-000000000001');
    expect(out.limit).toBe(5);
  });
});

describe('SuggestService.cacheKey (B3.3)', () => {
  it('includes scope, cityId, limit and prefix so two different queries never share a key', () => {
    const { service } = makeService({} as never);
    const a = service.cacheKey(service.normalize({ ...baseQuery, scope: 'business' }));
    const b = service.cacheKey(service.normalize({ ...baseQuery, scope: 'category' }));
    expect(a).not.toBe(b);
  });

  it('distinguishes a cityId-scoped query from a global one', () => {
    const { service } = makeService({} as never);
    const scoped = service.cacheKey(
      service.normalize({
        ...baseQuery,
        scope: 'neighborhood',
        cityId: '00000000-0000-0000-0000-000000000001',
      }),
    );
    const global = service.cacheKey(service.normalize({ ...baseQuery, scope: 'neighborhood' }));
    expect(scoped).not.toBe(global);
  });

  it('uses the normalised prefix, so Arabic and Persian spellings hit the same cache entry', () => {
    const { service } = makeService({} as never);
    const arabic = service.cacheKey(service.normalize({ ...baseQuery, q: 'كافه' }));
    const persian = service.cacheKey(service.normalize({ ...baseQuery, q: 'کافه' }));
    expect(arabic).toBe(persian);
  });
});

describe('SuggestService.suggest — scope=all merge (B3.3)', () => {
  it('merges all four scopes, sorts by score desc, and caps to limit', async () => {
    const businessHit = (score: number, slug: string): SuggestHit => ({
      kind: 'business',
      id: `00000000-0000-0000-0000-00000000000${slug}`,
      slug,
      label: `کافه ${slug}`,
      labelAlt: null,
      sublabel: 'تهران',
      score,
    });
    const catHit = (score: number, slug: string): SuggestHit => ({
      kind: 'category',
      id: `00000000-0000-0000-0000-00000000010${slug}`,
      slug,
      label: `دسته ${slug}`,
      labelAlt: null,
      sublabel: null,
      score,
    });
    const { service } = makeService({
      suggestBusinesses: async () => [businessHit(0.9, 'a'), businessHit(0.5, 'b')],
      suggestCategories: async () => [catHit(0.7, 'c')],
      suggestNeighborhoods: async () => [],
      suggestCities: async () => [],
    });
    const out = await service.suggest({ ...baseQuery, limit: 2 });
    expect(out.items).toHaveLength(2);
    // Sorted by score desc: 0.9 (business a), 0.7 (category c).
    expect(out.items[0]!.slug).toBe('a');
    expect(out.items[0]!.kind).toBe('business');
    expect(out.items[1]!.slug).toBe('c');
    expect(out.items[1]!.kind).toBe('category');
  });

  it('dedupes by kind+id (defence against cross-scope duplication)', async () => {
    const dup: SuggestHit = {
      kind: 'business',
      id: '00000000-0000-0000-0000-0000000000aa',
      slug: 'x',
      label: 'X',
      labelAlt: null,
      sublabel: null,
      score: 1,
    };
    const { service } = makeService({
      suggestBusinesses: async () => [dup],
      suggestCategories: async () => [],
      suggestNeighborhoods: async () => [],
      suggestCities: async () => [dup], // impossible in practice, but tests dedup
    });
    const out = await service.suggest({ ...baseQuery, limit: 10 });
    expect(out.items).toHaveLength(1);
  });

  it('caches the merged result so a second call does not hit the repository', async () => {
    const businessSpy = vi.fn(async () => [
      {
        kind: 'business',
        id: '00000000-0000-0000-0000-0000000000aa',
        slug: 'a',
        label: 'A',
        labelAlt: null,
        sublabel: null,
        score: 1,
      } as SuggestHit,
    ]);
    const { service, cacheStore } = makeService({
      suggestBusinesses: businessSpy,
      suggestCategories: async () => [],
      suggestNeighborhoods: async () => [],
      suggestCities: async () => [],
    });
    await service.suggest(baseQuery);
    await service.suggest(baseQuery); // should hit the cache
    expect(businessSpy).toHaveBeenCalledTimes(1);
    expect(cacheStore.size).toBe(1);
  });

  it('returns an empty list without hitting the repo when the prefix normalises to empty', async () => {
    const businessSpy = vi.fn(async () => [] as SuggestHit[]);
    const { service, cacheStore } = makeService({
      suggestBusinesses: businessSpy,
      suggestCategories: async () => [],
      suggestNeighborhoods: async () => [],
      suggestCities: async () => [],
    });
    const out = await service.suggest({ ...baseQuery, q: '   ' });
    expect(out.items).toEqual([]);
    expect(businessSpy).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0); // empty result is not cached
  });

  it('forwards cityId to the business and neighborhood scopes (category/city SQL ignores it)', async () => {
    const businessSpy = vi.fn(async (_q: unknown) => [] as SuggestHit[]);
    const neighSpy = vi.fn(async (_q: unknown) => [] as SuggestHit[]);
    const catSpy = vi.fn(async (_q: unknown) => [] as SuggestHit[]);
    const citySpy = vi.fn(async (_q: unknown) => [] as SuggestHit[]);
    const { service } = makeService({
      suggestBusinesses: businessSpy,
      suggestCategories: catSpy,
      suggestNeighborhoods: neighSpy,
      suggestCities: citySpy,
    });
    await service.suggest({
      q: 'ولیعصر',
      scope: 'all',
      cityId: '00000000-0000-0000-0000-000000000099',
      limit: 8,
    });
    // scope=all fans out to all four scopes.
    expect(businessSpy).toHaveBeenCalledTimes(1);
    expect(neighSpy).toHaveBeenCalledTimes(1);
    expect(catSpy).toHaveBeenCalledTimes(1);
    expect(citySpy).toHaveBeenCalledTimes(1);
    // business + neighborhood receive the cityId (their SQL uses it to scope).
    expect((businessSpy.mock.calls[0]![0] as { cityId: string }).cityId).toBe(
      '00000000-0000-0000-0000-000000000099',
    );
    expect((neighSpy.mock.calls[0]![0] as { cityId: string }).cityId).toBe(
      '00000000-0000-0000-0000-000000000099',
    );
    // The category/city repo methods receive the same query object but their
    // SQL does not reference cityId — the field is simply ignored. (Verifying
    // the SQL ignores it is a DB integration test, recorded in Follow-ups.)
  });
});
