import { describe, expect, it } from 'vitest';
import { orderedWeekdays } from '../../src/components/business/business-hours';

/**
 * F4.1 — the weekly-hours table orders the 7 ISO weekdays (1=Mon … 7=Sun)
 * starting at the locale's first weekday (`firstDayOfWeek`: 6 for fa =
 * Saturday, 0 for en = Sunday). This is the one piece of real logic in the
 * hours section; the rendering is covered by typecheck + the i18n-key scan +
 * the visual check.
 */
describe('orderedWeekdays', () => {
  it('is Saturday-first for fa (firstDay=6 → Sat,Sun,Mon…Fri)', () => {
    expect(orderedWeekdays(6)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });

  it('is Sunday-first for en (firstDay=0 → Sun,Mon…Sat)', () => {
    expect(orderedWeekdays(0)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });

  it('is Monday-first when firstDay=1', () => {
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('always yields 7 unique days in 1..7 for every firstDay', () => {
    for (let fd = 0; fd <= 6; fd++) {
      const got = orderedWeekdays(fd);
      expect(got).toHaveLength(7);
      expect(new Set(got).size).toBe(7);
      expect(got.every((d) => d >= 1 && d <= 7)).toBe(true);
    }
  });
});
