import { describe, expect, it } from 'vitest';
import { pickLocalized } from '../text.js';
import {
  bboxSchema,
  createCityBodySchema,
  createNeighborhoodBodySchema,
  geoPointSchema,
  ianaTimezoneSchema,
  updateCityBodySchema,
} from '../catalog.js';

describe('pickLocalized (B2.1)', () => {
  it('returns the requested locale when present', () => {
    expect(pickLocalized({ fa: 'تهران', en: 'Tehran' }, 'en')).toBe('Tehran');
  });

  it('falls back to the fallback locale when the requested one is absent', () => {
    expect(pickLocalized({ fa: 'تهران', en: 'Tehran' }, 'ar', 'en')).toBe('Tehran');
  });

  it('falls back to fa when neither requested nor fallback is present', () => {
    expect(pickLocalized({ fa: 'تهران', en: 'Tehran' }, 'ar', 'ru')).toBe('تهران');
  });

  it('skips an empty requested locale and uses the fallback', () => {
    expect(pickLocalized({ fa: 'تهران', en: '' }, 'en', undefined)).toBe('تهران');
  });

  it('returns fa even when it is the only key', () => {
    expect(pickLocalized({ fa: 'اصفهان' }, 'en')).toBe('اصفهان');
  });

  it('never returns an empty string when fa exists (validated LocalizedText)', () => {
    expect(pickLocalized({ fa: 'تبریز', en: 'Tabriz' }, 'de', 'fr')).toBe('تبریز');
  });
});

describe('geoPoint + bbox (B2.1)', () => {
  it('accepts a valid point', () => {
    expect(geoPointSchema.safeParse({ lat: 35.6892, lng: 51.389 }).success).toBe(true);
  });

  it('rejects latitude out of range', () => {
    expect(geoPointSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(geoPointSchema.safeParse({ lat: -91, lng: 0 }).success).toBe(false);
  });

  it('rejects longitude out of range', () => {
    expect(geoPointSchema.safeParse({ lat: 0, lng: 181 }).success).toBe(false);
    expect(geoPointSchema.safeParse({ lat: 0, lng: -181 }).success).toBe(false);
  });

  it('rejects extra keys (strict)', () => {
    expect(geoPointSchema.safeParse({ lat: 0, lng: 0, extra: 1 }).success).toBe(false);
  });

  it('rejects a bbox where east <= west', () => {
    expect(bboxSchema.safeParse({ west: 10, south: 0, east: 10, north: 5 }).success).toBe(false);
    expect(bboxSchema.safeParse({ west: 20, south: 0, east: 10, north: 5 }).success).toBe(false);
  });

  it('rejects a bbox where north <= south', () => {
    expect(bboxSchema.safeParse({ west: 0, south: 10, east: 5, north: 10 }).success).toBe(false);
  });

  it('accepts a valid bbox', () => {
    expect(bboxSchema.safeParse({ west: 0, south: 0, east: 10, north: 10 }).success).toBe(true);
  });
});

describe('ianaTimezoneSchema (B2.1)', () => {
  it('accepts a valid IANA timezone', () => {
    expect(ianaTimezoneSchema.safeParse('Asia/Tehran').success).toBe(true);
    expect(ianaTimezoneSchema.safeParse('UTC').success).toBe(true);
  });

  it('rejects an invalid timezone', () => {
    expect(ianaTimezoneSchema.safeParse('Not/A_Zone').success).toBe(false);
  });
});

describe('createCityBodySchema (B2.1)', () => {
  const valid = {
    name: { fa: 'اصفهان', en: 'Isfahan' },
    center: { lat: 32.6539, lng: 51.666 },
  };

  it('accepts a minimal body (slug optional, defaults omitted)', () => {
    expect(createCityBodySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a full body with bbox containing the center', () => {
    expect(
      createCityBodySchema.safeParse({
        ...valid,
        slug: 'isfahan',
        bbox: { west: 51, south: 32, east: 52, north: 33 },
        timezone: 'Asia/Tehran',
        isActive: false,
        sortOrder: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects a center outside the bbox', () => {
    expect(
      createCityBodySchema.safeParse({
        ...valid,
        bbox: { west: 0, south: 0, east: 1, north: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a name without fa', () => {
    expect(createCityBodySchema.safeParse({ ...valid, name: { en: 'Isfahan' } }).success).toBe(
      false,
    );
  });
});

describe('updateCityBodySchema (B2.1)', () => {
  it('accepts an empty partial (no fields)', () => {
    expect(updateCityBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single-field update', () => {
    expect(updateCityBodySchema.safeParse({ isActive: true }).success).toBe(true);
  });

  it('rejects an invalid partial slug', () => {
    expect(updateCityBodySchema.safeParse({ slug: 'UPPER CASE' }).success).toBe(false);
  });
});

describe('createNeighborhoodBodySchema (B2.1)', () => {
  it('accepts a minimal neighborhood', () => {
    expect(
      createNeighborhoodBodySchema.safeParse({
        name: { fa: 'امیریه' },
        center: { lat: 32.65, lng: 51.66 },
      }).success,
    ).toBe(true);
  });

  it('rejects a name without fa', () => {
    expect(
      createNeighborhoodBodySchema.safeParse({
        name: { en: 'Amirieh' },
        center: { lat: 0, lng: 0 },
      }).success,
    ).toBe(false);
  });
});
