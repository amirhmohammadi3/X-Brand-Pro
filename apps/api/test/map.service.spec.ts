import { describe, expect, it, vi } from 'vitest';
import { MapService } from '../src/modules/map/map.service.js';
import { mapQuerySchema } from '@app/contracts';
import type { MapCluster, MapPoint, MapQuery } from '@app/contracts';

/**
 * B3.4 map service — the pieces testable without a live Postgres+PostGIS or
 * Redis: the zoom→mode resolution, the Web-Mercator grid cell computation,
 * the quantized cache-key construction, and the meta/truncated shape. The
 * repository's PostGIS SQL (ST_MakeEnvelope && GiST prefilter + ST_Within +
 * ST_SnapToGrid clustering) is integration-tested against Docker per the
 * Follow-up.
 *
 * The fake cache stores values in a Map and never "fails" (the real
 * CacheService degrades to a miss on Redis errors — tested in
 * redis.cache.spec.ts).
 */
function makeService(
  repo: {
    countInBbox: (bbox: unknown, cityId?: string) => Promise<number>;
    findClusters: (q: unknown) => Promise<MapCluster[]>;
    findPoints: (q: unknown) => Promise<MapPoint[]>;
  },
  cacheStore = new Map<string, unknown>(),
) {
  const cache = {
    async wrap<T>(key: string, _ttl: number, produce: () => Promise<T>): Promise<T> {
      const cached = cacheStore.get(key);
      if (cached !== undefined) return cached as T;
      const v = await produce();
      cacheStore.set(key, v);
      return v;
    },
  };
  return {
    service: new MapService(repo as never, cache as never),
    cacheStore,
  };
}

/** A Tehran-spanning bbox; the numbers themselves are irrelevant to the pure
 * logic under test (any order-valid bbox works). */
const tehranBbox = { west: 51.1, south: 35.6, east: 51.7, north: 35.9 };
const baseQuery: MapQuery = { bbox: tehranBbox, zoom: 10 };

describe('mapQuerySchema (contract validation, B3.4)', () => {
  it('accepts a well-formed bbox + zoom and parses the corners into numbers', () => {
    const parsed = mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,35.9', zoom: '12' });
    expect(parsed.bbox).toEqual({ west: 51.1, south: 35.6, east: 51.7, north: 35.9 });
    expect(parsed.zoom).toBe(12);
  });

  it('defaults zoom to 14 (points mode)', () => {
    const parsed = mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,35.9' });
    expect(parsed.zoom).toBe(14);
  });

  it('rejects a bbox with the wrong part count or an empty part', () => {
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,51.7' })).toThrow();
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,,35.9' })).toThrow();
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,35.9,extra' })).toThrow();
  });

  it('rejects non-numeric and reversed-corner bboxes', () => {
    expect(() => mapQuerySchema.parse({ bbox: 'a,35.6,51.7,35.9' })).toThrow();
    // east < west
    expect(() => mapQuerySchema.parse({ bbox: '51.7,35.6,51.1,35.9' })).toThrow();
    // north < south
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.9,51.7,35.6' })).toThrow();
  });

  it('rejects out-of-range zoom and out-of-range coordinates', () => {
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,35.9', zoom: 0 })).toThrow();
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,35.9', zoom: 23 })).toThrow();
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,95.9' })).toThrow();
    expect(() => mapQuerySchema.parse({ bbox: '-200,35.6,51.7,35.9' })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => mapQuerySchema.parse({ bbox: '51.1,35.6,51.7,35.9', q: 'cafe' })).toThrow();
  });
});

describe('MapService.normalize / cellDegForZoom (B3.4)', () => {
  it('resolves clusters below zoom 14 and points from zoom 14 up', () => {
    const svc = new MapService(undefined as never, undefined as never);
    expect(svc.normalize({ ...baseQuery, zoom: 1 }).mode).toBe('clusters');
    expect(svc.normalize({ ...baseQuery, zoom: 13 }).mode).toBe('clusters');
    expect(svc.normalize({ ...baseQuery, zoom: 14 }).mode).toBe('points');
    expect(svc.normalize({ ...baseQuery, zoom: 22 }).mode).toBe('points');
  });

  it('keeps the parsed bbox, cityId and the points cap in the normalized query', () => {
    const svc = new MapService(undefined as never, undefined as never);
    const q = svc.normalize({
      ...baseQuery,
      zoom: 16,
      cityId: '11111111-1111-1111-1111-111111111111',
    });
    expect(q.bbox).toEqual(tehranBbox);
    expect(q.cityId).toBe('11111111-1111-1111-1111-111111111111');
    expect(q.pointLimit).toBe(1000);
    const withoutCity = svc.normalize({ ...baseQuery, zoom: 16 });
    expect(withoutCity.cityId).toBeUndefined();
  });

  it('computes the grid cell as 90 / 2^zoom (≈64px cell at 256px tiles)', () => {
    const svc = new MapService(undefined as never, undefined as never);
    expect(svc.cellDegForZoom(1)).toBeCloseTo(45, 10);
    expect(svc.cellDegForZoom(4)).toBeCloseTo(5.625, 10);
    expect(svc.cellDegForZoom(8)).toBeCloseTo(0.3515625, 10);
    expect(svc.cellDegForZoom(13)).toBeCloseTo(90 / 8192, 12);
    // clusters never run at zoom ≥ 14, so the cell stays ≥ ~0.011°
    expect(svc.cellDegForZoom(13)).toBeGreaterThan(0.01);
  });

  it('carries the cell into the normalized query only for the cluster mode', () => {
    const svc = new MapService(undefined as never, undefined as never);
    expect(svc.normalize({ ...baseQuery, zoom: 10 }).cellDeg).toBeCloseTo(90 / 1024, 12);
  });
});

describe('MapService.cacheKey (B3.4)', () => {
  const svc = new MapService(undefined as never, undefined as never);

  it('includes zoom, cityId and the four quantized corners', () => {
    const key = svc.cacheKey({
      bbox: tehranBbox,
      zoom: 10,
      mode: 'clusters',
      cellDeg: 0.1,
      pointLimit: 1000,
    });
    expect(key).toBe('map:v1:10:all:51.100:35.600:51.700:35.900');
    const withCity = svc.cacheKey({
      bbox: tehranBbox,
      zoom: 10,
      mode: 'clusters',
      cellDeg: 0.1,
      cityId: '22222222-2222-2222-2222-222222222222',
      pointLimit: 1000,
    });
    expect(withCity).toBe(
      'map:v1:10:22222222-2222-2222-2222-222222222222:51.100:35.600:51.700:35.900',
    );
  });

  it('quantizes corners to 3 decimals — sub-111m jitter maps to the same key', () => {
    const q = (west: number): Parameters<typeof svc.cacheKey>[0] => ({
      bbox: { ...tehranBbox, west },
      zoom: 10,
      mode: 'clusters',
      cellDeg: 0.1,
      pointLimit: 1000,
    });
    expect(svc.cacheKey(q(51.10001))).toBe(svc.cacheKey(q(51.10044)));
    expect(svc.cacheKey(q(51.10001))).not.toBe(svc.cacheKey(q(51.101)));
  });

  it('handles negative coordinates symmetric around zero', () => {
    const key = svc.cacheKey({
      bbox: { west: -0.0004, south: -1.0004, east: 0.0004, north: 1.0004 },
      zoom: 5,
      mode: 'clusters',
      cellDeg: 2,
      pointLimit: 1000,
    });
    // -0.0004 rounds to -0, and `toFixed` normalizes -0 to "0.000" — so the
    // zero cell has ONE cache key, never two (-0/+0 variants).
    expect(key).toBe('map:v1:5:all:0.000:-1.000:0.000:1.000');
  });
});

describe('MapService.map (read-through cache + shapes, B3.4)', () => {
  const cluster: MapCluster = { location: { lat: 35.7, lng: 51.4 }, count: 7 };
  const point: MapPoint = {
    id: '33333333-3333-3333-3333-333333333333',
    slug: 'cafe-azadi',
    name: 'کافه آزادی',
    primaryCategorySlug: 'cafe',
    location: { lat: 35.7, lng: 51.4 },
    avgRating: 4.5,
    reviewCount: 12,
    isFeatured: false,
  };

  function countingRepo(counts: number[], clusters: MapCluster[], points: MapPoint[]) {
    let countCalls = 0;
    let clusterCalls = 0;
    let pointCalls = 0;
    return {
      repo: {
        countInBbox: vi.fn(async () => counts[countCalls++] ?? counts[counts.length - 1] ?? 0),
        findClusters: vi.fn(async () => {
          clusterCalls += 1;
          return clusters;
        }),
        findPoints: vi.fn(async () => {
          pointCalls += 1;
          return points;
        }),
      },
      calls: () => ({ countCalls, clusterCalls, pointCalls }),
    };
  }

  it('clusters mode: fetches count + clusters, meta.truncated is false', async () => {
    const { repo, calls } = countingRepo([42], [cluster], []);
    const { service } = makeService(repo);
    const result = await service.map({ ...baseQuery, zoom: 10 });
    expect(result.mode).toBe('clusters');
    if (result.mode !== 'clusters') return;
    expect(result.items).toEqual([cluster]);
    expect(result.meta).toEqual({ zoom: 10, total: 42, truncated: false });
    expect(calls().clusterCalls).toBe(1);
    expect(calls().pointCalls).toBe(0);
  });

  it('points mode: fetches count + points, truncation flagged when capped', async () => {
    const { repo } = countingRepo([1500], [], [point, point]);
    const { service } = makeService(repo);
    const result = await service.map({ ...baseQuery, zoom: 16 });
    expect(result.mode).toBe('points');
    if (result.mode !== 'points') return;
    expect(result.meta).toEqual({ zoom: 16, total: 1500, truncated: true });
  });

  it('points mode: not truncated when the viewport holds ≤ the cap', async () => {
    const { repo } = countingRepo([2], [], [point, point]);
    const { service } = makeService(repo);
    const result = await service.map({ ...baseQuery, zoom: 14 });
    if (result.mode !== 'points') return;
    expect(result.meta.truncated).toBe(false);
  });

  it('empty viewport: points mode is not truncated at total=0', async () => {
    const { repo } = countingRepo([0], [], []);
    const { service } = makeService(repo);
    const result = await service.map({ ...baseQuery, zoom: 16 });
    if (result.mode !== 'points') return;
    expect(result.items).toEqual([]);
    expect(result.meta).toEqual({ zoom: 16, total: 0, truncated: false });
  });

  it('second identical call hits the cache and does NOT re-run the repository', async () => {
    const { repo, calls } = countingRepo([42], [cluster], []);
    const { service } = makeService(repo);
    await service.map({ ...baseQuery, zoom: 10 });
    await service.map({ ...baseQuery, zoom: 10 });
    expect(calls().countCalls).toBe(1);
    expect(calls().clusterCalls).toBe(1);
  });

  it('a different zoom, city or quantized bbox changes the key and re-fetches', async () => {
    const { repo, calls } = countingRepo([42], [cluster], []);
    const { service } = makeService(repo);
    await service.map({ ...baseQuery, zoom: 10 });
    await service.map({ ...baseQuery, zoom: 11 });
    await service.map({ ...baseQuery, zoom: 10, cityId: '44444444-4444-4444-4444-444444444444' });
    await service.map({ ...baseQuery, bbox: { ...tehranBbox, west: 51.101 }, zoom: 10 });
    expect(calls().countCalls).toBe(4);
  });

  it('a sub-111m bbox jitter still hits the cache (same quantized cell)', async () => {
    const { repo, calls } = countingRepo([42], [cluster], []);
    const { service } = makeService(repo);
    await service.map({ ...baseQuery, zoom: 10, bbox: { ...tehranBbox, west: 51.1000001 } });
    await service.map({ ...baseQuery, zoom: 10, bbox: { ...tehranBbox, west: 51.1000007 } });
    expect(calls().countCalls).toBe(1);
  });

  it('cache hit restores meta (total/truncated) without a re-query', async () => {
    const { repo } = countingRepo([1500], [], [point, point]);
    const { service, cacheStore } = makeService(repo);
    const first = await service.map({ ...baseQuery, zoom: 16 });
    expect(first.mode).toBe('points');
    if (first.mode !== 'points') return;
    expect(first.meta.truncated).toBe(true);
    // Poison the repo so any re-query would break the result — the cache hit
    // must rebuild meta from the stored payload.
    (repo as unknown as { countInBbox: () => Promise<number> }).countInBbox = async () => {
      throw new Error('should not re-query');
    };
    const second = await service.map({ ...baseQuery, zoom: 16 });
    if (second.mode !== 'points') return;
    expect(second.meta).toEqual({ zoom: 16, total: 1500, truncated: true });
    expect(cacheStore.size).toBe(1);
  });
});
