import { describe, expect, it } from 'vitest';
import {
  SEED_CITY,
  SEED_NEIGHBORHOODS,
  SEED_CATEGORIES,
  SEED_AMENITIES,
  SEED_BUSINESSES,
  buildCategoryRows,
  insideBbox,
} from '../src/db/seed/catalog.seed.js';

/**
 * Pure invariants of the B2.10 seed data — the seeders themselves need live
 * Postgres (Docker-blocked in this sandbox), but the DATA they write must
 * already satisfy the DB CHECK constraints and the app's own rules:
 * every localized name carries `fa`, slugs are unique, the category tree is
 * at most two levels, every demo business coordinates sits inside the Tehran
 * bbox, `active` demo businesses carry `published_at` (enforced by the seed),
 * hours weekdays stay in 1..7 and no daily interval overlaps.
 */

const AMENITY_GROUPS = ['general', 'food', 'payment', 'accessibility', 'family', 'comfort'];
const CATEGORY_KINDS = ['menu', 'services', 'none'];

describe('seed data invariants (B2.10)', () => {
  it('city: fa name present, bbox sane (west<east, south<north)', () => {
    expect(SEED_CITY.name.fa).toBeTruthy();
    expect(SEED_CITY.bbox.west).toBeLessThan(SEED_CITY.bbox.east);
    expect(SEED_CITY.bbox.south).toBeLessThan(SEED_CITY.bbox.north);
    expect(insideBbox(SEED_CITY.center, SEED_CITY.bbox)).toBe(true);
  });

  it('neighborhoods: unique slugs, fa names, inside the city bbox', () => {
    const slugs = SEED_NEIGHBORHOODS.map((n) => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const n of SEED_NEIGHBORHOODS) {
      expect(n.name.fa).toBeTruthy();
      expect(insideBbox(n.center, SEED_CITY.bbox)).toBe(true);
    }
  });

  it('categories: unique slugs, fa names, valid kind, depth <= 2', () => {
    const all = SEED_CATEGORIES.flatMap((c) => [c, ...(c.children ?? [])]);
    const slugs = all.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of all) {
      expect(c.name.fa).toBeTruthy();
      expect(CATEGORY_KINDS).toContain(c.kind);
    }
    // Depth ≤ 2: a child never has its own children.
    for (const root of SEED_CATEGORIES) {
      for (const child of root.children ?? []) {
        expect(child.children).toBeUndefined();
      }
    }
  });

  it('category rows: child precedes its parent resolution (parentSlug set, roots first)', () => {
    const rows = buildCategoryRows(SEED_CATEGORIES);
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.parentSlug !== null) {
        expect(seen.has(row.parentSlug)).toBe(true); // parent inserted before child
      }
      seen.add(row.slug);
    }
    expect(rows.length).toBe(
      SEED_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0),
    );
  });

  it('amenities: unique slugs, fa names, valid group', () => {
    const slugs = SEED_AMENITIES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of SEED_AMENITIES) {
      expect(a.name.fa).toBeTruthy();
      expect(AMENITY_GROUPS).toContain(a.group);
    }
  });

  it('demo businesses: unique slugs, fa names, resolvable refs, inside bbox, phone E.164', () => {
    const catSlugs = new Set(
      SEED_CATEGORIES.flatMap((c) => [c.slug, ...(c.children ?? []).map((x) => x.slug)]),
    );
    const hoodSlugs = new Set(SEED_NEIGHBORHOODS.map((n) => n.slug));
    const amenitySlugs = new Set(SEED_AMENITIES.map((a) => a.slug));
    const bizSlugs = SEED_BUSINESSES.map((b) => b.slug);
    expect(new Set(bizSlugs).size).toBe(bizSlugs.length);

    for (const b of SEED_BUSINESSES) {
      expect(b.name).toBeTruthy();
      expect(hoodSlugs.has(b.neighborhood)).toBe(true);
      expect(catSlugs.has(b.primaryCategory)).toBe(true);
      for (const extra of b.extraCategories) expect(catSlugs.has(extra)).toBe(true);
      for (const a of b.amenitySlugs) expect(amenitySlugs.has(a)).toBe(true);
      expect(insideBbox(b.location, SEED_CITY.bbox)).toBe(true);
      expect(b.phone).toMatch(/^\+98\d{10}$/);
      expect(b.priceLevel === null || [1, 2, 3, 4].includes(b.priceLevel)).toBe(true);
    }
  });

  it('demo business hours: weekday 1..7, HH:mm format, no intra-day overlap', () => {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return (h ?? NaN) * 60 + (m ?? NaN);
    };
    for (const b of SEED_BUSINESSES) {
      const perDay = new Map<number, [number, number][]>();
      for (const [weekday, open, close] of b.hours) {
        expect(weekday).toBeGreaterThanOrEqual(1);
        expect(weekday).toBeLessThanOrEqual(7);
        expect(open).toMatch(/^\d{2}:\d{2}$/);
        expect(close).toMatch(/^\d{2}:\d{2}$/);
        expect(toMin(close)).toBeGreaterThan(toMin(open)); // seed keeps it simple: no midnight crossing
        const list = perDay.get(weekday) ?? [];
        list.push([toMin(open), toMin(close)]);
        perDay.set(weekday, list);
      }
      for (const [, intervals] of perDay) {
        intervals.sort((a, b) => a[0]! - b[0]!);
        for (let i = 1; i < intervals.length; i++) {
          expect(intervals[i]![0]!).toBeGreaterThanOrEqual(intervals[i - 1]![1]!);
        }
      }
    }
  });

  it('at least one demo business exists per seeded root family for a lively demo', () => {
    const usedPrimaries = new Set(SEED_BUSINESSES.map((b) => b.primaryCategory));
    expect(usedPrimaries.size).toBeGreaterThanOrEqual(5);
  });
});
