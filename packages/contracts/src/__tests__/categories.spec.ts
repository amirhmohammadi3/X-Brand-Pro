import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ACCENTS,
  CATEGORY_ICONS,
  categoryAccentSchema,
  categoryIconSchema,
  categoryKindSchema,
  createCategoryBodySchema,
  publicCategoryNodeSchema,
  updateCategoryBodySchema,
} from '../catalog.js';

describe('CATEGORY_ICONS (B2.2)', () => {
  it('has at least 60 icons', () => {
    expect(CATEGORY_ICONS.length).toBeGreaterThanOrEqual(60);
  });

  it('entries are unique', () => {
    expect(new Set(CATEGORY_ICONS).size).toBe(CATEGORY_ICONS.length);
  });

  it('covers the directory domains (food, health, shopping, services, education, entertainment, travel, home, sports, pets, art)', () => {
    const set = new Set(CATEGORY_ICONS);
    expect(set.has('utensils')).toBe(true);
    expect(set.has('heart-pulse')).toBe(true);
    expect(set.has('shopping-bag')).toBe(true);
    expect(set.has('wrench')).toBe(true);
    expect(set.has('graduation-cap')).toBe(true);
    expect(set.has('gamepad-2')).toBe(true);
    expect(set.has('plane')).toBe(true);
    expect(set.has('home')).toBe(true);
    expect(set.has('dumbbell')).toBe(true);
    expect(set.has('paw-print')).toBe(true);
    expect(set.has('palette')).toBe(true);
  });
});

describe('categoryIconSchema (B2.2)', () => {
  it('accepts an allow-listed icon', () => {
    expect(categoryIconSchema.safeParse('utensils').success).toBe(true);
  });

  it('rejects an icon not in the allow-list', () => {
    expect(categoryIconSchema.safeParse('not-a-real-icon').success).toBe(false);
    expect(categoryIconSchema.safeParse('Pizza').success).toBe(false); // case-sensitive
  });
});

describe('categoryAccentSchema + categoryKindSchema (B2.2)', () => {
  it('accepts accent-1..8 only', () => {
    expect(CATEGORY_ACCENTS).toHaveLength(8);
    for (const a of CATEGORY_ACCENTS) expect(categoryAccentSchema.safeParse(a).success).toBe(true);
    expect(categoryAccentSchema.safeParse('accent-9').success).toBe(false);
    expect(categoryAccentSchema.safeParse('#ff0000').success).toBe(false); // no raw hex
  });

  it('accepts menu/services/none only', () => {
    expect(categoryKindSchema.safeParse('menu').success).toBe(true);
    expect(categoryKindSchema.safeParse('services').success).toBe(true);
    expect(categoryKindSchema.safeParse('none').success).toBe(true);
    expect(categoryKindSchema.safeParse('other').success).toBe(false);
  });
});

describe('createCategoryBodySchema (B2.2)', () => {
  const valid = { name: { fa: 'غذا' }, icon: 'utensils' };

  it('accepts a minimal root category (no parentId)', () => {
    expect(createCategoryBodySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a child with a parentId and a color', () => {
    expect(
      createCategoryBodySchema.safeParse({
        ...valid,
        parentId: '00000000-0000-0000-0000-000000000001',
        color: 'accent-3',
        kind: 'menu',
        supportsReservation: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a name without fa', () => {
    expect(createCategoryBodySchema.safeParse({ ...valid, name: { en: 'Food' } }).success).toBe(
      false,
    );
  });

  it('rejects an icon outside the allow-list', () => {
    expect(createCategoryBodySchema.safeParse({ ...valid, icon: 'bogus' }).success).toBe(false);
  });

  it('rejects a raw-hex color', () => {
    expect(createCategoryBodySchema.safeParse({ ...valid, color: '#abc' }).success).toBe(false);
  });
});

describe('updateCategoryBodySchema (B2.2)', () => {
  it('accepts an empty partial', () => {
    expect(updateCategoryBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts moving to a root (parentId null)', () => {
    expect(updateCategoryBodySchema.safeParse({ parentId: null }).success).toBe(true);
  });
});

describe('publicCategoryNodeSchema (B2.2)', () => {
  it('accepts a root with children (leaves have no children field)', () => {
    expect(
      publicCategoryNodeSchema.safeParse({
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'food',
        name: { fa: 'غذا' },
        description: null,
        icon: 'utensils',
        color: null,
        kind: 'none',
        supportsReservation: false,
        children: [
          {
            id: '00000000-0000-0000-0000-000000000002',
            slug: 'cafe',
            name: { fa: 'کافه' },
            description: null,
            icon: 'coffee',
            color: 'accent-2',
            kind: 'menu',
            supportsReservation: true,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
