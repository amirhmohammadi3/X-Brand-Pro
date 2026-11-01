import { describe, expect, it } from 'vitest';
import {
  createFormatters,
  firstDayOfWeek,
  fromIsoToJalaliParts,
  toIsoDateFromJalali,
  toPersianDigits,
} from '../src/lib/format';

/**
 * Formatting table tests (F1.1): Persian digits, Jalali conversion of known
 * dates (including the 1403 leap-year edge), month names, relative time
 * wording, money Toman conversion, compact numbers, week start.
 */

const fa = createFormatters('fa');
const en = createFormatters('en');

// Noon UTC keeps both the UTC sandbox and an Asia/Tehran machine on the same
// civil day (Tehran is UTC+3:30).
const noonOn = (isoDate: string): Date => new Date(`${isoDate}T12:00:00Z`);

describe('formatNumber', () => {
  it.each([
    [1234.5, 'fa', '۱٬۲۳۴٫۵'],
    [1234.5, 'en', '1,234.5'],
    [0, 'fa', '۰'],
    [9_999_999, 'en', '9,999,999'],
  ])('formats %d in %s as %s', (value, locale, expected) => {
    expect(createFormatters(locale).formatNumber(value)).toBe(expected);
  });

  it('uses Persian digits ONLY for fa (en stays ASCII)', () => {
    expect(fa.formatNumber(1234)).toContain('۱');
    expect(en.formatNumber(1234)).toBe('1,234');
    expect(en.formatNumber(1234)).not.toMatch(/[\u06F0-\u06F9]/);
  });

  it('formats percentages', () => {
    expect(fa.formatPercent(0.42)).toBe('۴۲٪');
    expect(en.formatPercent(0.42)).toBe('42%');
  });
});

describe('formatCompact', () => {
  it('compacts in the active locale', () => {
    // ICU joins the quantity and unit with a no-break space (U+00A0):
    expect(fa.formatCompact(1200)).toBe('۱٫۲\u00A0هزار');
    expect(en.formatCompact(1200)).toBe('1.2K');
  });
});

describe('formatMoneyIrr', () => {
  it('divides Rials by 10, groups thousands and appends the unit', () => {
    expect(fa.formatMoneyIrr(1_234_500)).toBe('۱۲۳٬۴۵۰ تومان');
    expect(fa.formatMoneyIrr(1_234_500, { unit: 'تومان' })).toBe('۱۲۳٬۴۵۰ تومان');
    expect(en.formatMoneyIrr(1_234_500, { unit: 'Toman' })).toBe('123,450 Toman');
  });

  it('keeps zero and negative amounts readable', () => {
    expect(fa.formatMoneyIrr(0)).toBe('۰ تومان');
    expect(en.formatMoneyIrr(-5000, { unit: 'Toman' })).toBe('-500 Toman');
  });
});

describe('Jalali ↔ Gregorian conversion', () => {
  // Six known pairs minimum (prompt F1.1), including the 1403 leap edge.
  it.each([
    ['2026-03-21', { jy: 1405, jm: 1, jd: 1 }], // Nowruz 1405
    ['2025-03-20', { jy: 1403, jm: 12, jd: 30 }], // 1403 IS leap → 30 Esfand exists
    ['2025-03-21', { jy: 1404, jm: 1, jd: 1 }], // Nowruz 1404
    ['2024-03-19', { jy: 1402, jm: 12, jd: 29 }], // 1402 not leap → 29 Esfand
    ['2024-03-20', { jy: 1403, jm: 1, jd: 1 }], // Nowruz 1403
    ['2026-11-01', { jy: 1405, jm: 8, jd: 10 }], // Aban 1405
  ])('converts %s to Jalali %j', (iso, parts) => {
    expect(fromIsoToJalaliParts(noonOn(iso))).toEqual(parts);
  });

  it('round-trips Jalali parts back to ISO (leap edge included)', () => {
    expect(toIsoDateFromJalali(1405, 1, 1)).toBe('2026-03-21');
    expect(toIsoDateFromJalali(1403, 12, 30)).toBe('2025-03-20');
    expect(toIsoDateFromJalali(1402, 12, 29)).toBe('2024-03-19');
  });

  it('names the Persian months', () => {
    expect(fa.formatDate(noonOn('2026-03-21'))).toBe('۱ فروردین ۱۴۰۵');
    expect(fa.formatDate(noonOn('2025-03-20'))).toBe('۳۰ اسفند ۱۴۰۳');
    expect(fa.formatDate(noonOn('2026-11-01'), 'long')).toMatch(/آبان/);
  });

  it('formats the Gregorian calendar for non-fa locales', () => {
    expect(en.formatDate(noonOn('2026-03-21'))).toBe('March 21, 2026');
    expect(en.formatDate(noonOn('2026-03-21'), 'short')).toBe('03/21/2026');
  });
});

describe('formatDateTime / formatTime', () => {
  it('uses a 24-hour clock and Persian digits for fa', () => {
    expect(fa.formatTime('2026-03-21T08:30:00Z')).toBe('۱۲:۰۰'); // +3:30 Tehran
    expect(fa.formatDateTime('2026-03-21T08:30:00Z')).toBe('۱ فروردین ۱۴۰۵، ۱۲:۰۰');
  });

  it('honors an explicit time zone (city/business override)', () => {
    expect(fa.formatTime('2026-03-21T08:30:00Z', { timeZone: 'UTC' })).toBe('۰۸:۳۰');
    expect(en.formatTime('2026-03-21T08:30:00Z', { timeZone: 'UTC' })).toBe('08:30');
  });
});

describe('formatRelative', () => {
  it('uses natural fa wording for the past («۳ ساعت پیش»)', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const threeHoursAgo = new Date('2026-03-21T09:00:00Z');
    expect(fa.formatRelative(threeHoursAgo, { now })).toBe('۳ ساعت پیش');
    expect(en.formatRelative(threeHoursAgo, { now })).toBe('3 hours ago');
  });

  it('picks natural units (پریروز for the day before yesterday)', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    expect(fa.formatRelative(new Date('2026-03-19T12:00:00Z'), { now })).toBe('پریروز');
  });

  it('handles the future', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    expect(en.formatRelative(new Date('2026-03-21T13:00:00Z'), { now })).toBe('in 1 hour');
  });
});

describe('week start and digits', () => {
  it('starts the week on Saturday for fa and Sunday for en', () => {
    expect(firstDayOfWeek('fa')).toBe(6);
    expect(firstDayOfWeek('en')).toBe(0);
  });

  it('converts ASCII digits to Persian digits', () => {
    expect(toPersianDigits('1405/01/01')).toBe('۱۴۰۵/۰۱/۰۱');
    expect(toPersianDigits('no digits')).toBe('no digits');
  });
});
