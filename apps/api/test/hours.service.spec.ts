import { describe, expect, it } from 'vitest';
import { computeOpenStatus } from '../src/modules/business/hours/hours.service.js';
import type { SpecialDay, WeeklyHours } from '@app/contracts';

/**
 * computeOpenStatus (B2.5) — pure table-driven tests. `now` is always a UTC
 * instant; the helpers below build a UTC Date for a given wall-clock time in
 * the business city's timezone. Tehran is UTC+03:30 with no DST since 2022, so
 * the Tehran helper is exact. London's offset varies with DST, so the London
 * helper takes the known UTC offset (0 = GMT winter, 1 = BST summer) so the
 * test stays deterministic without depending on the runtime tz database beyond
 * what Intl resolves at the target instant.
 */

/** UTC instant whose Tehran wall clock is Y/M/D H:Min (Tehran = UTC+03:30, no DST). */
function tehran(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 3.5 * 3600 * 1000);
}

/** UTC instant whose London wall clock is Y/M/D H:Min, given the UTC offset hour. */
function london(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  offsetHours: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetHours * 3600 * 1000);
}

const TZ = 'Asia/Tehran';

/** A single interval on one weekday. */
function day(
  weekday: number,
  open: string,
  close: string,
): { weekday: number; intervals: { open: string; close: string }[] } {
  return { weekday, intervals: [{ open, close }] };
}
function allDay(weekday: number): { weekday: number; allDay: true } {
  return { weekday, allDay: true };
}

function status(
  weekly: WeeklyHours,
  now: Date,
  opts: { specialDays?: SpecialDay[]; tz?: string; soon?: number } = {},
) {
  return computeOpenStatus({
    weekly,
    specialDays: opts.specialDays ?? [],
    timezone: opts.tz ?? TZ,
    now,
    soonMinutes: opts.soon,
  });
}

describe('computeOpenStatus — basic open/closed (B2.5)', () => {
  const weekly: WeeklyHours = [day(1, '09:00', '17:00')]; // Mondays 09–17

  it('is closed before opening', () => {
    expect(status(weekly, tehran(2026, 2, 2, 7, 0)).state).toBe('closed'); // Mon 07:00, 120 min before open
  });
  it('is open exactly at open time (inclusive)', () => {
    expect(status(weekly, tehran(2026, 2, 2, 9, 0)).state).toBe('open'); // Mon 09:00
  });
  it('is closed exactly at close time (exclusive)', () => {
    expect(status(weekly, tehran(2026, 2, 2, 17, 0)).state).toBe('closed'); // Mon 17:00
  });
  it('is open during the interval', () => {
    expect(status(weekly, tehran(2026, 2, 2, 12, 0)).state).toBe('open'); // Mon 12:00
  });
  it('is closed after close', () => {
    expect(status(weekly, tehran(2026, 2, 2, 18, 0)).state).toBe('closed'); // Mon 18:00
  });
  it('is closed on an unscheduled weekday', () => {
    expect(status(weekly, tehran(2026, 2, 3, 12, 0)).state).toBe('closed'); // Tue 12:00
  });
});

describe('computeOpenStatus — all-day (B2.5)', () => {
  const weekly: WeeklyHours = [allDay(1)];
  it('is open at 03:00 on an all-day weekday and reports no next change', () => {
    const r = status(weekly, tehran(2026, 2, 2, 3, 0));
    expect(r.state).toBe('open');
    expect(r.isOpen).toBe(true);
    expect(r.nextChangeAt).toBeNull();
  });
});

describe('computeOpenStatus — midnight crossing (B2.5)', () => {
  // Friday (5) 20:00 → 02:00 (crosses into Saturday early hours)
  const weekly: WeeklyHours = [day(5, '20:00', '02:00')];

  it('is open during the late part of the crossing interval (Fri 21:00)', () => {
    expect(status(weekly, tehran(2026, 2, 6, 21, 0)).state).toBe('open'); // Fri 21:00
  });
  it('is open via the previous-day tail on Saturday 01:00 Tehran time (UTC now)', () => {
    // 2026-02-07 is a Saturday; Tehran 01:00 = UTC 21:30 the day before.
    expect(status(weekly, tehran(2026, 2, 7, 1, 0)).isOpen).toBe(true);
  });
  it('is closed after the tail ends (Sat 02:30)', () => {
    expect(status(weekly, tehran(2026, 2, 7, 2, 30)).state).toBe('closed');
  });
  it('reports nextChangeAt on the crossing interval as tomorrow’s close', () => {
    const r = status(weekly, tehran(2026, 2, 6, 21, 0)); // Fri 21:00
    expect(r.state).toBe('open');
    expect(r.nextChangeAt).not.toBeNull();
    // next change ≈ Sat 02:00 Tehran = 5h after 21:00
    const delta =
      (new Date(r.nextChangeAt as string).getTime() - tehran(2026, 2, 6, 21, 0).getTime()) / 60000;
    expect(delta).toBeGreaterThan(4 * 60);
    expect(delta).toBeLessThan(6 * 60);
  });
});

describe('computeOpenStatus — special days (B2.5)', () => {
  const weekly: WeeklyHours = [day(1, '09:00', '17:00')]; // Mondays open
  // 2026-02-02 is a Monday in Tehran.

  it('a closed special day overrides a normally open day → closed', () => {
    const sd: SpecialDay[] = [
      { date: '2026-02-02', closed: true, intervals: undefined, note: null },
    ];
    expect(status(weekly, tehran(2026, 2, 2, 12, 0), { specialDays: sd }).state).toBe('closed');
  });
  it('an open special day opens a normally closed weekday', () => {
    // Tuesday 2026-02-03 is normally closed; a special day opens 10:00–14:00.
    const sd: SpecialDay[] = [
      {
        date: '2026-02-03',
        closed: false,
        intervals: [{ open: '10:00', close: '14:00' }],
        note: null,
      },
    ];
    expect(status(weekly, tehran(2026, 2, 3, 11, 0), { specialDays: sd }).state).toBe('open');
    expect(status(weekly, tehran(2026, 2, 3, 15, 0), { specialDays: sd }).state).toBe('closed');
  });
  it('a closed special day today cancels the previous day’s midnight-crossing tail', () => {
    // Friday 20:00→02:00 normally spills into Saturday early hours. A closed
    // special day on Saturday cancels that tail.
    const weekly2: WeeklyHours = [day(5, '20:00', '02:00')];
    const sd: SpecialDay[] = [
      { date: '2026-02-07', closed: true, intervals: undefined, note: null },
    ];
    expect(status(weekly2, tehran(2026, 2, 7, 1, 0), { specialDays: sd }).state).toBe('closed');
  });
  it('without a closed special day, the previous-day tail continues (contrast)', () => {
    const weekly2: WeeklyHours = [day(5, '20:00', '02:00')];
    expect(status(weekly2, tehran(2026, 2, 7, 1, 0), { specialDays: [] }).isOpen).toBe(true);
  });
});

describe('computeOpenStatus — soon states (B2.5)', () => {
  const weekly: WeeklyHours = [day(1, '09:00', '17:00')]; // Mon 09–17, soon=60

  it('is closing_soon 30 minutes before close', () => {
    expect(status(weekly, tehran(2026, 2, 2, 16, 30), { soon: 60 }).state).toBe('closing_soon');
  });
  it('is closing_soon exactly at the soon boundary (60 min before close)', () => {
    expect(status(weekly, tehran(2026, 2, 2, 16, 0), { soon: 60 }).state).toBe('closing_soon');
  });
  it('is open (not closing_soon) 61 minutes before close', () => {
    expect(status(weekly, tehran(2026, 2, 2, 15, 59), { soon: 60 }).state).toBe('open');
  });
  it('is opening_soon 30 minutes before open', () => {
    expect(status(weekly, tehran(2026, 2, 2, 8, 30), { soon: 60 }).state).toBe('opening_soon');
  });
  it('is closed (not opening_soon) 61 minutes before open', () => {
    expect(status(weekly, tehran(2026, 2, 2, 7, 59), { soon: 60 }).state).toBe('closed');
  });
});

describe('computeOpenStatus — Friday vs Saturday in Tehran with a UTC now (B2.5)', () => {
  // Friday 20:00→02:00 crosses into Saturday. A UTC `now` of 2026-02-06T17:00Z
  // is Tehran Friday 20:30 (open); a UTC `now` of 2026-02-06T21:00Z is Tehran
  // Saturday 00:30 (open via the tail); 2026-02-06T23:00Z is Tehran Sat 02:30
  // (closed, tail ended).
  const weekly: WeeklyHours = [day(5, '20:00', '02:00')];

  it('Fri 20:30 Tehran (UTC 17:00Z) → open', () => {
    expect(status(weekly, new Date('2026-02-06T17:00:00Z')).state).toBe('open');
  });
  it('Sat 00:30 Tehran (UTC 21:00Z) → open via tail', () => {
    expect(status(weekly, new Date('2026-02-06T21:00:00Z')).state).toBe('open');
  });
  it('Sat 02:30 Tehran (UTC 23:00Z) → closed', () => {
    expect(status(weekly, new Date('2026-02-06T23:00:00Z')).state).toBe('closed');
  });
});

describe('computeOpenStatus — next change + closed lookahead (B2.5)', () => {
  it('nextChangeAt on a normal interval points to today’s close (valid ISO, after now)', () => {
    const weekly: WeeklyHours = [day(1, '09:00', '17:00')];
    const now = tehran(2026, 2, 2, 12, 0); // Mon 12:00
    const r = status(weekly, now);
    expect(r.nextChangeAt).not.toBeNull();
    const next = new Date(r.nextChangeAt as string);
    expect(Number.isNaN(next.getTime())).toBe(false);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('closed now with tomorrow’s first open reports nextChangeAt for tomorrow', () => {
    // Sunday 2026-02-08 12:00 Tehran (no Sunday schedule); next open is Monday
    // 2026-02-09 09:00 → within the 1-day lookahead.
    const weekly: WeeklyHours = [day(1, '09:00', '17:00')];
    const now = tehran(2026, 2, 8, 12, 0); // Sun 12:00
    const r = status(weekly, now);
    expect(r.state).toBe('closed');
    expect(r.nextChangeAt).not.toBeNull();
    // next change ≈ Mon 09:00 Tehran ≈ 21h after Sun 12:00
    const deltaH = (new Date(r.nextChangeAt as string).getTime() - now.getTime()) / 3600000;
    expect(deltaH).toBeGreaterThan(20);
    expect(deltaH).toBeLessThan(22);
  });

  it('closed before today’s only open reports nextChangeAt for today’s open', () => {
    const weekly: WeeklyHours = [day(5, '20:00', '02:00')];
    const now = tehran(2026, 2, 6, 10, 0); // Fri 10:00, opens at 20:00
    const r = status(weekly, now);
    expect(r.state).toBe('closed');
    expect(r.nextChangeAt).not.toBeNull();
    const deltaH = (new Date(r.nextChangeAt as string).getTime() - now.getTime()) / 3600000;
    expect(deltaH).toBeCloseTo(10, 0);
  });

  it('returns todayIntervals for display (the day’s own schedule)', () => {
    const weekly: WeeklyHours = [day(1, '09:00', '17:00')];
    const r = status(weekly, tehran(2026, 2, 2, 12, 0));
    expect(r.todayIntervals).toEqual([{ open: '09:00', close: '17:00' }]);
  });
});

describe('computeOpenStatus — DST zone (Europe/London) (B2.5)', () => {
  // All 7 days 09:00–17:00. London is GMT (UTC+0) in winter, BST (UTC+1) in summer.
  const weekly: WeeklyHours = [
    day(1, '09:00', '17:00'),
    day(2, '09:00', '17:00'),
    day(3, '09:00', '17:00'),
    day(4, '09:00', '17:00'),
    day(5, '09:00', '17:00'),
    day(6, '09:00', '17:00'),
    day(7, '09:00', '17:00'),
  ];

  it('winter (GMT): 09:30 London → open, 17:30 London → closed', () => {
    expect(status(weekly, london(2026, 1, 15, 9, 30, 0), { tz: 'Europe/London' }).state).toBe(
      'open',
    );
    expect(status(weekly, london(2026, 1, 15, 17, 30, 0), { tz: 'Europe/London' }).state).toBe(
      'closed',
    );
  });
  it('summer (BST): 12:30 London → open, 17:30 London → closed', () => {
    expect(status(weekly, london(2026, 6, 15, 12, 30, 1), { tz: 'Europe/London' }).state).toBe(
      'open',
    );
    expect(status(weekly, london(2026, 6, 15, 17, 30, 1), { tz: 'Europe/London' }).state).toBe(
      'closed',
    );
  });
  it('spring-forward day (2026-03-29, BST after 02:00): 09:30 London → open', () => {
    // After the 01:00→02:00 jump, the rest of the day is BST (UTC+1).
    expect(status(weekly, london(2026, 3, 29, 9, 30, 1), { tz: 'Europe/London' }).state).toBe(
      'open',
    );
    expect(status(weekly, london(2026, 3, 29, 17, 30, 1), { tz: 'Europe/London' }).state).toBe(
      'closed',
    );
  });
  it('fall-back day (2026-10-25): a 01:00–03:00 schedule is open at 01:30 GMT (post fall-back)', () => {
    const weekly2: WeeklyHours = [
      day(7, '01:00', '03:00'),
      day(1, '01:00', '03:00'),
      day(2, '01:00', '03:00'),
      day(3, '01:00', '03:00'),
      day(4, '01:00', '03:00'),
      day(5, '01:00', '03:00'),
      day(6, '01:00', '03:00'),
    ];
    // 2026-10-25 is a Sunday. After fall-back (02:00 BST→01:00 GMT), 01:30 GMT
    // (UTC+0) is the second occurrence of 01:30 → still inside [01:00, 03:00).
    expect(status(weekly2, london(2026, 10, 25, 1, 30, 0), { tz: 'Europe/London' }).state).toBe(
      'open',
    );
  });
});

describe('computeOpenStatus — edge cases (B2.5)', () => {
  it('a business with no weekly schedule and no special days is always closed', () => {
    const r = status([], tehran(2026, 2, 2, 12, 0));
    expect(r.state).toBe('closed');
    expect(r.isOpen).toBe(false);
    expect(r.nextChangeAt).toBeNull();
  });
  it('a 24:00 close (end of day) is open until midnight', () => {
    const weekly: WeeklyHours = [day(1, '10:00', '24:00')];
    expect(status(weekly, tehran(2026, 2, 2, 23, 30)).isOpen).toBe(true);
    expect(status(weekly, tehran(2026, 2, 3, 0, 30)).state).toBe('closed'); // next day, no schedule
  });
  it('a crossing interval is open right before midnight on its start day', () => {
    const weekly: WeeklyHours = [day(5, '20:00', '02:00')];
    expect(status(weekly, tehran(2026, 2, 6, 23, 59)).state).toBe('open');
  });
});
