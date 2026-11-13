/**
 * Profile + hours editor pure-helper tests (F7.2). The form components are
 * client-side react-hook-form; these specs cover the value- transforming
 * helpers that turn form state into API bodies (empty → null, tags split,
 * closed weekdays omitted) — the parts with real logic.
 */
import { describe, expect, it } from 'vitest';
import { buildUpdateBody } from '../../src/components/dashboard/profile-editor';
import { buildWeekly } from '../../src/components/dashboard/hours-editor';
import type { DayState } from '../../src/components/dashboard/hours-editor';
import { buildMenuBody } from '../../src/components/dashboard/menu-editor';

describe('buildUpdateBody', () => {
  it('trims name/address and converts empty contact strings to null', () => {
    const body = buildUpdateBody({
      name: '  کافه نمک  ',
      nameAlt: '',
      description: '   ',
      address: '  تهران  ',
      phone: '',
      whatsapp: '',
      telegram: '',
      instagram: '',
      website: '',
      email: '',
      priceLevel: '',
      tags: '',
    });
    expect(body.name).toBe('کافه نمک');
    expect(body.address).toBe('تهران');
    expect(body.description).toBeNull();
    expect(body.phone).toBeNull();
    expect(body.email).toBeNull();
    expect(body.priceLevel).toBeNull();
    expect(body.tags).toEqual([]);
  });

  it('keeps non-empty contacts and parses price level + tags', () => {
    const body = buildUpdateBody({
      name: 'Cafe',
      nameAlt: 'Cafe Namak',
      description: ' Good food ',
      address: 'Tehran',
      phone: '02112345678',
      whatsapp: '',
      telegram: '@cafe',
      instagram: 'cafe',
      website: 'https://cafe.example',
      email: 'a@b.c',
      priceLevel: '3',
      tags: 'coffee, tea , breakfast',
    });
    expect(body.phone).toBe('02112345678');
    expect(body.telegram).toBe('@cafe');
    expect(body.website).toBe('https://cafe.example');
    expect(body.priceLevel).toBe(3);
    expect(body.tags).toEqual(['coffee', 'tea', 'breakfast']);
  });

  it('drops tags outside the 1..60 length band', () => {
    const body = buildUpdateBody({
      name: 'Cafe',
      nameAlt: '',
      description: '',
      address: 'Tehran',
      phone: '',
      whatsapp: '',
      telegram: '',
      instagram: '',
      website: '',
      email: '',
      priceLevel: '',
      tags: 'ok, ' + 'x'.repeat(61) + ', also-ok',
    });
    expect(body.tags).toEqual(['ok', 'also-ok']);
  });
});

describe('buildWeekly', () => {
  it('omits closed days and keeps allDay + intervals', () => {
    const days: Record<number, DayState> = {
      1: { mode: 'closed', intervals: [] },
      2: { mode: 'allDay', intervals: [] },
      3: { mode: 'intervals', intervals: [{ open: '09:00', close: '17:00' }] },
      6: { mode: 'intervals', intervals: [{ open: '', close: '' }] }, // empty → dropped
    };
    const weekly = buildWeekly(days);
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toEqual({ weekday: 2, allDay: true });
    expect(weekly[1]).toEqual({ weekday: 3, intervals: [{ open: '09:00', close: '17:00' }] });
  });

  it('returns an empty array when every day is closed', () => {
    const days: Record<number, DayState> = {
      1: { mode: 'closed', intervals: [] },
      7: { mode: 'closed', intervals: [] },
    };
    expect(buildWeekly(days)).toEqual([]);
  });

  it('keeps up to 3 intervals and drops only the blank ones', () => {
    const days: Record<number, DayState> = {
      4: {
        mode: 'intervals',
        intervals: [
          { open: '08:00', close: '12:00' },
          { open: '', close: '' },
          { open: '16:00', close: '21:00' },
        ],
      },
    };
    const weekly = buildWeekly(days);
    expect(weekly).toHaveLength(1);
    expect(weekly[0]?.intervals).toHaveLength(2);
  });
});

describe('buildMenuBody', () => {
  it('converts Toman to Rials (×10), empty price → null, drops blank sections/items', () => {
    const body = buildMenuBody([
      {
        name: 'نوشیدنی‌ها',
        items: [
          { name: 'چای', description: '', price: '15', isAvailable: true },
          { name: 'قهوه', description: 'دوبله', price: '', isAvailable: true },
          { name: '', description: '', price: '', isAvailable: true }, // blank → dropped
        ],
      },
      { name: '', items: [] }, // blank section → dropped
    ]);
    expect(body.sections).toHaveLength(1);
    const section = body.sections[0];
    expect(section?.name).toBe('نوشیدنی‌ها');
    expect(section?.items).toHaveLength(2);
    expect(section?.items[0]?.price).toBe(150); // 15 Toman → 150 Rials
    expect(section?.items[0]?.description).toBeNull();
    expect(section?.items[1]?.price).toBeNull();
    expect(section?.items[1]?.description).toBe('دوبله');
  });

  it('returns an empty sections array for an empty editor', () => {
    expect(buildMenuBody([])).toEqual({ sections: [] });
  });
});
