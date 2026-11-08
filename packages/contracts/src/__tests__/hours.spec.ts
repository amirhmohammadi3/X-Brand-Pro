import { describe, expect, it } from 'vitest';
import {
  closeTimeSchema,
  crossesMidnight,
  intervalDayCoverage,
  intervalSchema,
  openStatusSchema,
  rangesOverlap,
  replaceWeeklyHoursBodySchema,
  specialDaySchema,
  timeToMinutes,
  timeOfDaySchema,
  upsertSpecialDayBodySchema,
  weekdaySchema,
  weeklyDaySchema,
  weeklyHoursSchema,
} from '../hours.js';

/**
 * hours contracts (B2.5) — schema validation table tests: weekday range,
 * time-of-day + 24:00 close, intervals (crossing midnight, all-day, zero-length
 * rejection), weekly schedule (duplicate weekday, overlap, >3 intervals, the
 * allDay/intervals exclusivity), special days (closed+intervals conflict), the
 * open-status shape, and the pure helper functions used by `computeOpenStatus`.
 */

describe('weekdaySchema (B2.5)', () => {
  it.each([1, 2, 4, 7])('accepts %s', (n) => expect(weekdaySchema.parse(n)).toBe(n));
  it.each([0, 8, -1, 1.5])('rejects %s', (n) => expect(() => weekdaySchema.parse(n)).toThrow());
});

describe('timeOfDaySchema (B2.5)', () => {
  it.each([
    ['09:00', '09:00'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
    ['۰۹:۰۰', '09:00'], // Persian digits normalised
    ['۱۸:۳۰', '18:30'],
  ])('normalises %s → %s', (input, expected) => {
    expect(timeOfDaySchema.parse(input)).toBe(expected);
  });
  it.each(['24:00', '23:60', '9:00', '-1:00', '09:0', 'noon'])(
    'rejects %s as a time-of-day',
    (input) => expect(() => timeOfDaySchema.parse(input)).toThrow(),
  );
});

describe('closeTimeSchema (B2.5)', () => {
  it.each(['24:00', '00:00', '23:59', '17:00'])('accepts close %s', (v) =>
    expect(closeTimeSchema.parse(v)).toBe(v === '24:00' ? '24:00' : v),
  );
  it('rejects 24:01 as a close time', () => expect(() => closeTimeSchema.parse('24:01')).toThrow());
});

describe('intervalSchema (B2.5)', () => {
  it('accepts a normal interval', () =>
    expect(intervalSchema.parse({ open: '09:00', close: '17:00' })).toEqual({
      open: '09:00',
      close: '17:00',
    }));
  it('accepts a midnight-crossing interval', () =>
    expect(intervalSchema.parse({ open: '20:00', close: '02:00' })).toEqual({
      open: '20:00',
      close: '02:00',
    }));
  it('accepts an all-day interval (00:00–24:00)', () =>
    expect(intervalSchema.parse({ open: '00:00', close: '24:00' })).toEqual({
      open: '00:00',
      close: '24:00',
    }));
  it('rejects a zero-length interval', () =>
    expect(() => intervalSchema.parse({ open: '09:00', close: '09:00' })).toThrow());
  it('rejects extra keys (.strict)', () =>
    expect(() => intervalSchema.parse({ open: '09:00', close: '17:00', foo: 1 })).toThrow());
});

describe('weeklyDaySchema (B2.5)', () => {
  it('accepts an allDay day', () =>
    expect(weeklyDaySchema.parse({ weekday: 1, allDay: true })).toEqual({
      weekday: 1,
      allDay: true,
    }));
  it('accepts an intervals day', () =>
    expect(
      weeklyDaySchema.parse({ weekday: 2, intervals: [{ open: '09:00', close: '17:00' }] }),
    ).toBeTruthy());
  it('accepts an empty-intervals day (closed)', () =>
    expect(weeklyDaySchema.parse({ weekday: 3, intervals: [] })).toEqual({
      weekday: 3,
      intervals: [],
    }));
  it('rejects allDay + intervals together', () =>
    expect(() =>
      weeklyDaySchema.parse({
        weekday: 1,
        allDay: true,
        intervals: [{ open: '09:00', close: '17:00' }],
      }),
    ).toThrow());
  it('rejects a day with neither allDay nor intervals', () =>
    expect(() => weeklyDaySchema.parse({ weekday: 1 })).toThrow());
});

describe('weeklyHoursSchema (B2.5)', () => {
  const good = [
    { weekday: 1, intervals: [{ open: '09:00', close: '17:00' }] },
    { weekday: 6, allDay: true },
  ];

  it('accepts a valid weekly schedule', () =>
    expect(weeklyHoursSchema.parse(good)).toHaveLength(2));
  it('rejects a duplicate weekday', () =>
    expect(() =>
      weeklyHoursSchema.parse([
        { weekday: 1, intervals: [{ open: '09:00', close: '17:00' }] },
        { weekday: 1, intervals: [{ open: '18:00', close: '23:00' }] },
      ]),
    ).toThrow());
  it('rejects overlapping intervals within a day', () =>
    expect(() =>
      weeklyHoursSchema.parse([
        {
          weekday: 1,
          intervals: [
            { open: '09:00', close: '17:00' },
            { open: '16:00', close: '20:00' },
          ],
        },
      ]),
    ).toThrow());
  it('rejects more than 3 intervals per day', () =>
    expect(() =>
      weeklyHoursSchema.parse([
        {
          weekday: 1,
          intervals: [
            { open: '08:00', close: '10:00' },
            { open: '11:00', close: '13:00' },
            { open: '14:00', close: '16:00' },
            { open: '17:00', close: '19:00' },
          ],
        },
      ]),
    ).toThrow());
  it('accepts non-overlapping crossing intervals', () =>
    expect(
      weeklyHoursSchema.parse([
        {
          weekday: 5,
          intervals: [
            { open: '08:00', close: '12:00' },
            { open: '20:00', close: '02:00' },
          ],
        },
      ]),
    ).toHaveLength(1));
  it('rejects overlapping crossing intervals', () =>
    expect(() =>
      weeklyHoursSchema.parse([
        {
          weekday: 5,
          intervals: [
            { open: '20:00', close: '03:00' },
            { open: '22:00', close: '04:00' },
          ],
        },
      ]),
    ).toThrow());
});

describe('specialDaySchema + upsert body (B2.5)', () => {
  it('accepts a closed special day', () =>
    expect(specialDaySchema.parse({ date: '2026-01-01', closed: true, note: null })).toEqual({
      date: '2026-01-01',
      closed: true,
      intervals: undefined,
      note: null,
    }));
  it('accepts an open special day with intervals', () =>
    expect(
      specialDaySchema.parse({
        date: '2026-01-01',
        closed: false,
        intervals: [{ open: '10:00', close: '14:00' }],
      }),
    ).toBeTruthy());
  it('rejects a malformed date', () =>
    expect(() =>
      specialDaySchema.parse({ date: '2026-13-40', closed: true, note: null }),
    ).toThrow());
  it('rejects a closed special day carrying intervals', () =>
    expect(() =>
      upsertSpecialDayBodySchema.parse({
        closed: true,
        intervals: [{ open: '10:00', close: '14:00' }],
      }),
    ).toThrow());
});

describe('openStatusSchema + replaceWeeklyHoursBodySchema (B2.5)', () => {
  it('accepts a well-formed open status', () =>
    expect(
      openStatusSchema.parse({
        isOpen: true,
        state: 'open',
        nextChangeAt: '2026-01-01T17:00:00.000Z',
        todayIntervals: [{ open: '09:00', close: '17:00' }],
      }),
    ).toBeTruthy());
  it('rejects an unknown state', () =>
    expect(() =>
      openStatusSchema.parse({
        isOpen: true,
        state: 'maybe',
        nextChangeAt: null,
        todayIntervals: [],
      }),
    ).toThrow());
  it('accepts the replace-weekly body', () =>
    expect(
      replaceWeeklyHoursBodySchema.parse({ weekly: [{ weekday: 1, allDay: true }] }),
    ).toBeTruthy());
});

describe('pure helpers (B2.5)', () => {
  it('timeToMinutes converts HH:mm', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(timeToMinutes('24:00')).toBe(1440);
  });
  it('intervalDayCoverage for a normal interval', () =>
    expect(intervalDayCoverage({ open: '09:00', close: '17:00' })).toEqual([540, 1020]));
  it('intervalDayCoverage for a crossing interval ends at end of day', () =>
    expect(intervalDayCoverage({ open: '20:00', close: '02:00' })).toEqual([1200, 1440]));
  it('intervalDayCoverage for a 24:00 close ends at end of day', () =>
    expect(intervalDayCoverage({ open: '00:00', close: '24:00' })).toEqual([0, 1440]));
  it('crossesMidnight flags only true crossings', () => {
    expect(crossesMidnight({ open: '20:00', close: '02:00' })).toBe(true);
    expect(crossesMidnight({ open: '09:00', close: '17:00' })).toBe(false);
    expect(crossesMidnight({ open: '00:00', close: '24:00' })).toBe(false);
  });
  it('rangesOverlap detects overlap and disjoint', () => {
    expect(rangesOverlap([540, 1020], [600, 700])).toBe(true);
    expect(rangesOverlap([540, 1020], [1020, 1200])).toBe(false); // touch at boundary
    expect(rangesOverlap([0, 100], [200, 300])).toBe(false);
  });
});
