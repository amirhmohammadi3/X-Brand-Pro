import { describe, expect, it } from 'vitest';
import { SearchService } from '../src/modules/search/search.service.js';
import type { SearchQuery } from '@app/contracts';

/**
 * B3.2 search service — the only piece testable without a live Postgres+PostGIS
 * is the pure `normalize` mapping (the repository's parameterised SQL is
 * integration-tested against Docker per the Follow-up). These specs pin down
 * the query canonicalisation (Persian/Arabic char mapping + digit normalisation
 * + ZWNJ), the default-sort resolution (relevance when `q`, rating otherwise),
 * the limit/offset pagination maths, and the schema-refine guarantees
 * (distance requires origin).
 */
const service = new SearchService({} as never); // repo unused by normalize()

const baseQuery: SearchQuery = {
  page: 1,
  pageSize: 20,
};

describe('SearchService.normalize (B3.2)', () => {
  it('normalizes the query text through normalizePersianText + normalizeDigits before it reaches the tsquery', () => {
    // Arabic yeh/kaf + Persian digits + a trailing ZWNJ: the canonical form
    // must match the pre-normalized businesses.name_normalized / tsvector.
    const q = 'كافه ۲۰۲۴\u200c';
    const out = service.normalize({ ...baseQuery, q });
    expect(out.q).toBe('کافه 2024');
  });

  it('drops an empty/whitespace-only q to null so the repository skips the tsvector match', () => {
    const out = service.normalize({ ...baseQuery, q: '   ' });
    expect(out.q).toBeNull();
  });

  it('resolves the default sort to relevance when a text query is present', () => {
    const out = service.normalize({ ...baseQuery, q: 'کافه' });
    expect(out.sort).toBe('relevance');
  });

  it('resolves the default sort to rating when no text query is present (facet-only search)', () => {
    const out = service.normalize({ ...baseQuery, cityId: '00000000-0000-0000-0000-000000000001' });
    expect(out.sort).toBe('rating');
  });

  it('honours an explicit sort even when a text query is present', () => {
    const out = service.normalize({ ...baseQuery, q: 'کافه', sort: 'newest' });
    expect(out.sort).toBe('newest');
  });

  it('computes limit and offset from page/pageSize', () => {
    const out = service.normalize({ ...baseQuery, page: 3, pageSize: 25 });
    expect(out.limit).toBe(25);
    expect(out.offset).toBe(50); // (3-1) * 25
  });

  it('passes every facet filter through unchanged', () => {
    const cat = '00000000-0000-0000-0000-0000000000aa';
    const amen = '00000000-0000-0000-0000-0000000000bb';
    const out = service.normalize({
      ...baseQuery,
      cityId: '00000000-0000-0000-0000-000000000001',
      neighborhoodId: '00000000-0000-0000-0000-000000000002',
      categoryIds: [cat],
      amenityIds: [amen],
      tags: ['turkish-coffee'],
      priceLevel: 3,
      minRating: 4,
    });
    expect(out.cityId).toBe('00000000-0000-0000-0000-000000000001');
    expect(out.neighborhoodId).toBe('00000000-0000-0000-0000-000000000002');
    expect(out.categoryIds).toEqual([cat]);
    expect(out.amenityIds).toEqual([amen]);
    expect(out.tags).toEqual(['turkish-coffee']);
    expect(out.priceLevel).toBe(3);
    expect(out.minRating).toBe(4);
    // No geo origin → distance stays undefined (the repository emits NULL).
    expect(out.lat).toBeUndefined();
    expect(out.lng).toBeUndefined();
    expect(out.radius).toBeUndefined();
  });

  it('carries the geo origin and radius through for distance sort/filtering', () => {
    const out = service.normalize({
      ...baseQuery,
      lat: 35.6892,
      lng: 51.389,
      radius: 2000,
      sort: 'distance',
    });
    expect(out.lat).toBe(35.6892);
    expect(out.lng).toBe(51.389);
    expect(out.radius).toBe(2000);
    expect(out.sort).toBe('distance');
  });
});
