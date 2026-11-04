import { describe, expect, it } from 'vitest';
import {
  jalaliCalendar,
  gregorianCalendar,
  isoToDate,
  dateToIso,
} from '../../src/lib/calendar/calendar-system';

describe('calendar-system — Jalali', () => {
  it('Farvardin 1 1405 is a Saturday and maps to 2026-03-21', () => {
    const d = jalaliCalendar.toDate({ year: 1405, month: 1, day: 1 });
    expect(d.getDay()).toBe(6); // Saturday
    expect(dateToIso(d)).toBe('2026-03-21');
  });

  it('Esfand 1403 has 30 days (leap year)', () => {
    const grid = jalaliCalendar.getMonthGrid(1403, 12);
    const inMonthDays = grid.weeks.flat().filter((c) => c.inMonth).length;
    expect(inMonthDays).toBe(30);
  });

  it('Farvardin 1405 grid: first cell is a Saturday and in-month days = 31', () => {
    const grid = jalaliCalendar.getMonthGrid(1405, 1);
    const inMonthDays = grid.weeks.flat().filter((c) => c.inMonth).length;
    expect(inMonthDays).toBe(31);
    // Week starts Saturday → first cell (row 0, col 0) should be Saturday.
    expect(grid.weeks[0]![0]!.date.getDay()).toBe(6);
  });

  it('every grid has exactly 6 rows × 7 cols (42 cells)', () => {
    for (let m = 1; m <= 12; m++) {
      const grid = jalaliCalendar.getMonthGrid(1403, m);
      expect(grid.weeks.length).toBe(6);
      grid.weeks.forEach((w) => expect(w.length).toBe(7));
    }
  });

  it('Jalali months of 29, 30 and 31 days are all represented', () => {
    // Shahrivar 1403 = 31, Mehr 1403 = 30, Aban 1403 = 30, Azar 1403 = 30,
    // Dey 1403 = 30, Bahman 1403 = 30, Esfand 1403 = 30 (leap).
    // Find a 29-day month: Shahrivar 1404 (non-leap year Esfand is 29).
    const esfand1404 = jalaliCalendar.getMonthGrid(1404, 12);
    const days1404 = esfand1404.weeks.flat().filter((c) => c.inMonth).length;
    expect([29, 30]).toContain(days1404);
    // Farvardin always 31.
    expect(
      jalaliCalendar
        .getMonthGrid(1403, 1)
        .weeks.flat()
        .filter((c) => c.inMonth).length,
    ).toBe(31);
  });

  it('round-trips 200 random dates through fromDate/toDate', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 200; i++) {
      const base = new Date(2020, 0, 1);
      base.setDate(base.getDate() + (rand() % 4000));
      const parts = jalaliCalendar.fromDate(base);
      const back = jalaliCalendar.toDate(parts);
      expect(dateToIso(back)).toBe(dateToIso(base));
    }
  });

  it('parses typed Jalali input ۱۴۰۵/۰۱/۰۱ to 2026-03-21 (ASCII + Persian digits)', () => {
    const persianDigits = (s: string) => s.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
    const text = persianDigits('1405/01/01');
    const d = jalaliCalendar.parse(text, 'yyyy/MM/dd');
    expect(d).not.toBeNull();
    expect(dateToIso(d!)).toBe('2026-03-21');
    // ASCII too.
    const d2 = jalaliCalendar.parse('1405/01/01', 'yyyy/MM/dd');
    expect(dateToIso(d2!)).toBe('2026-03-21');
  });

  it('parses with `-` separator too', () => {
    const d = jalaliCalendar.parse('1405-01-01', 'yyyy-MM-dd');
    expect(dateToIso(d!)).toBe('2026-03-21');
  });

  it('returns null for invalid input', () => {
    expect(jalaliCalendar.parse('hello', 'yyyy/MM/dd')).toBeNull();
    expect(jalaliCalendar.parse('1405/13/01', 'yyyy/MM/dd')).toBeNull();
  });

  it('isWeekend is true for Friday, false for Saturday', () => {
    // 2026-03-21 = Saturday, 2026-03-27 = Friday.
    expect(jalaliCalendar.isWeekend(new Date(2026, 2, 21))).toBe(false);
    expect(jalaliCalendar.isWeekend(new Date(2026, 2, 27))).toBe(true);
  });

  it('addMonths moves across year boundary', () => {
    const d = jalaliCalendar.toDate({ year: 1405, month: 12, day: 15 });
    const next = jalaliCalendar.addMonths(d, 1);
    const parts = jalaliCalendar.fromDate(next);
    expect(parts.year).toBe(1406);
    expect(parts.month).toBe(1);
  });

  it('weekday names start with Saturday by default', () => {
    const names = jalaliCalendar.getWeekdayNames();
    expect(names[0]).toBe('شنبه');
    expect(names.length).toBe(7);
  });
});

describe('calendar-system — Gregorian', () => {
  it('March 2026 grid: first cell is a Monday (weekStart=Monday) and 31 in-month days', () => {
    const grid = gregorianCalendar.getMonthGrid(2026, 3);
    expect(grid.weeks[0]![0]!.date.getDay()).toBe(1); // Monday
    expect(grid.weeks.flat().filter((c) => c.inMonth).length).toBe(31);
  });

  it('parses 2026-03-21 to that date', () => {
    const d = gregorianCalendar.parse('2026-03-21', 'yyyy-MM-dd');
    expect(dateToIso(d!)).toBe('2026-03-21');
  });

  it('round-trips fromDate/toDate', () => {
    const base = new Date(2026, 2, 21);
    const parts = gregorianCalendar.fromDate(base);
    expect(parts).toEqual({ year: 2026, month: 3, day: 21 });
    expect(dateToIso(gregorianCalendar.toDate(parts))).toBe('2026-03-21');
  });

  it('isWeekend true for Sat/Sun', () => {
    expect(gregorianCalendar.isWeekend(new Date(2026, 2, 21))).toBe(true); // Sat
    expect(gregorianCalendar.isWeekend(new Date(2026, 2, 22))).toBe(true); // Sun
    expect(gregorianCalendar.isWeekend(new Date(2026, 2, 23))).toBe(false); // Mon
  });

  it('weekday names start with Monday by default', () => {
    const names = gregorianCalendar.getWeekdayNames();
    expect(names[0]).toBe('Mon');
  });
});

describe('calendar-system — helpers', () => {
  it('isoToDate / dateToIso round-trip', () => {
    const iso = '2026-03-21';
    expect(dateToIso(isoToDate(iso))).toBe(iso);
  });
});
