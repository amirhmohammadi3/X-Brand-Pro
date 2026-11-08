import { describe, expect, it } from 'vitest';
import {
  AMENITY_GROUPS,
  AMENITY_ICONS,
  amenityGroupSchema,
  amenityIconSchema,
  amenitySchema,
  createAmenityBodySchema,
  setCategoryAmenitiesBodySchema,
  updateAmenityBodySchema,
} from '../catalog.js';

describe('AMENITY_ICONS (B2.3)', () => {
  it('has at least 30 icons', () => {
    expect(AMENITY_ICONS.length).toBeGreaterThanOrEqual(30);
  });

  it('entries are unique', () => {
    expect(new Set(AMENITY_ICONS).size).toBe(AMENITY_ICONS.length);
  });

  it('covers amenity-relevant icons', () => {
    const set = new Set(AMENITY_ICONS);
    expect(set.has('wifi')).toBe(true);
    expect(set.has('parking-square')).toBe(true);
    expect(set.has('accessibility')).toBe(true);
    expect(set.has('snowflake')).toBe(true);
    expect(set.has('baby')).toBe(true);
  });
});

describe('amenityIconSchema + amenityGroupSchema (B2.3)', () => {
  it('accepts an allow-listed icon', () => {
    expect(amenityIconSchema.safeParse('wifi').success).toBe(true);
  });
  it('rejects an icon not in the allow-list', () => {
    expect(amenityIconSchema.safeParse('nope').success).toBe(false);
  });
  it('accepts the six groups only', () => {
    expect(AMENITY_GROUPS).toHaveLength(6);
    for (const g of AMENITY_GROUPS) expect(amenityGroupSchema.safeParse(g).success).toBe(true);
    expect(amenityGroupSchema.safeParse('other').success).toBe(false);
  });
});

describe('createAmenityBodySchema (B2.3)', () => {
  const valid = { name: { fa: 'وای‌فای', en: 'Wi-Fi' }, icon: 'wifi' };
  it('accepts a minimal amenity', () => {
    expect(createAmenityBodySchema.safeParse(valid).success).toBe(true);
  });
  it('rejects a name without fa', () => {
    expect(createAmenityBodySchema.safeParse({ ...valid, name: { en: 'Wi-Fi' } }).success).toBe(
      false,
    );
  });
  it('rejects an icon outside the allow-list', () => {
    expect(createAmenityBodySchema.safeParse({ ...valid, icon: 'bogus' }).success).toBe(false);
  });
});

describe('updateAmenityBodySchema (B2.3)', () => {
  it('accepts an empty partial', () => {
    expect(updateAmenityBodySchema.safeParse({}).success).toBe(true);
  });
});

describe('setCategoryAmenitiesBodySchema (B2.3)', () => {
  it('accepts up to 100 amenity ids', () => {
    const ids = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(setCategoryAmenitiesBodySchema.safeParse({ amenityIds: ids }).success).toBe(true);
  });
  it('rejects more than 100 ids', () => {
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(setCategoryAmenitiesBodySchema.safeParse({ amenityIds: ids }).success).toBe(false);
  });
  it('accepts an empty list (clears the mapping)', () => {
    expect(setCategoryAmenitiesBodySchema.safeParse({ amenityIds: [] }).success).toBe(true);
  });
});

describe('amenitySchema (B2.3)', () => {
  it('accepts a full amenity', () => {
    expect(
      amenitySchema.safeParse({
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'wifi',
        name: { fa: 'وای‌فای' },
        icon: 'wifi',
        group: 'general',
        isActive: true,
        sortOrder: 0,
      }).success,
    ).toBe(true);
  });
});
