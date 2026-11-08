import { z } from 'zod';
import { normalizeDigits } from './text.js';

/**
 * Business opening-hours contracts (B2.5).
 *
 * Weekly hours are an array of per-weekday entries: either `{ weekday,
 * intervals }` (up to 3 non-overlapping `HH:mm` intervals a day, where a
 * `close` of `24:00` means end of day and a `close` earlier than `open` means
 * the interval crosses midnight) or the `{ weekday, allDay: true }` shortcut.
 * A weekday absent from the array (or with empty intervals) is closed that day.
 *
 * Special days override a whole calendar day: `closed` cancels the day (and
 * cancels the previous day's midnight-crossing tail — see `computeOpenStatus`
 * in apps/api/src/modules/business/hours/hours.service.ts), otherwise the
 * supplied intervals replace the weekly schedule for that date.
 *
 * `openStatusSchema` is the computed "open now" result: a pure function of the
 * weekly schedule, nearby special days, the business city's IANA timezone and a
 * `now` instant (see DECISIONS B2.5 for the timezone/DST strategy).
 */

// ─── Weekday & time-of-day ───────────────────────────────────────────────

/** ISO weekday: 1 Monday … 7 Sunday. */
export const weekdaySchema = z.number().int().min(1).max(7);
export type Weekday = z.infer<typeof weekdaySchema>;

/** A `HH:mm` wall-clock time, 00:00–23:59. Persian/Arabic digits normalised. */
export const timeOfDaySchema = z
  .string()
  .transform((s) => normalizeDigits(s).trim())
  .pipe(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm (00:00–23:59)'));
export type TimeOfDay = z.infer<typeof timeOfDaySchema>;

/** A close time: same as time-of-day but also accepts `24:00` (end of day). */
export const closeTimeSchema = z
  .string()
  .transform((s) => normalizeDigits(s).trim())
  .pipe(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'expected HH:mm (00:00–24:00)'));
export type CloseTime = z.infer<typeof closeTimeSchema>;

// ─── Interval ────────────────────────────────────────────────────────────

/** Parse `HH:mm` (or `24:00`) into minutes since local midnight (0..1440). */
export function timeToMinutes(t: string): number {
  const parts = t.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return h * 60 + m;
}

/**
 * The portion of an interval that falls on ITS OWN day, as `[start, end)` in
 * minutes since midnight (0..1440). The next-day tail of a midnight-crossing
 * interval is excluded — it belongs to the following day and is handled by the
 * caller when computing the incoming tail.
 *  - all-day (`00:00`–`24:00`) → `[0, 1440)`
 *  - `close = 24:00` → `[open, 1440)`
 *  - normal (`close > open`) → `[open, close)`
 *  - crosses midnight (`close <= open`, `close ≠ 24:00`) → `[open, 1440)`
 */
export function intervalDayCoverage(iv: { open: string; close: string }): [number, number] {
  const open = timeToMinutes(iv.open);
  const close = iv.close === '24:00' ? 1440 : timeToMinutes(iv.close);
  if (close > open) return [open, close];
  return [open, 1440]; // crosses midnight: today's own part ends at end of day
}

/** Whether an interval crosses midnight (`close` earlier than `open`, not 24:00). */
export function crossesMidnight(iv: { open: string; close: string }): boolean {
  if (iv.close === '24:00') return false;
  return timeToMinutes(iv.close) <= timeToMinutes(iv.open);
}

/** True iff two half-open `[start, end)` ranges overlap. */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** An open/close interval. `close` may be `24:00`; `close` < `open` crosses midnight. */
export const intervalSchema = z
  .object({ open: timeOfDaySchema, close: closeTimeSchema })
  .strict()
  .superRefine((iv, ctx) => {
    // A zero-length interval is meaningless; `24:00` close is never equal to open
    // (open is at most 23:59), so only the plain-equal case is rejected.
    if (iv.close !== '24:00' && iv.open === iv.close) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'open and close must differ',
        path: ['close'],
      });
    }
  });
export type Interval = z.infer<typeof intervalSchema>;

// ─── Weekly schedule ─────────────────────────────────────────────────────

/**
 * One weekday's schedule: either `allDay: true` (open 24h) or a list of up to
 * 3 intervals. At least one of the two must be present; they are mutually
 * exclusive. Empty `intervals: []` is treated as closed that day.
 */
export const weeklyDaySchema = z
  .object({
    weekday: weekdaySchema,
    intervals: z.array(intervalSchema).max(3).optional(),
    allDay: z.boolean().optional(),
  })
  .strict()
  .superRefine((day, ctx) => {
    if (day.allDay === true) {
      if (day.intervals && day.intervals.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'allDay and intervals are mutually exclusive',
          path: ['allDay'],
        });
      }
    } else if (!day.intervals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide intervals or allDay: true',
        path: ['intervals'],
      });
    }
  });
export type WeeklyDay = z.infer<typeof weeklyDaySchema>;

/**
 * The weekly schedule: up to 7 entries, one per weekday (no duplicates), with
 * no overlapping intervals within a day. A weekday not listed is closed.
 */
export const weeklyHoursSchema = z
  .array(weeklyDaySchema)
  .max(7)
  .superRefine((days, ctx) => {
    const seen = new Set<number>();
    days.forEach((day) => {
      if (seen.has(day.weekday)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate weekday ${day.weekday}`,
          path: [String(day.weekday)],
        });
      }
      seen.add(day.weekday);
      if (day.intervals && day.allDay !== true) {
        const covers = day.intervals.map(intervalDayCoverage);
        for (let i = 0; i < covers.length; i++) {
          for (let j = i + 1; j < covers.length; j++) {
            const a = covers[i];
            const b = covers[j];
            if (a && b && rangesOverlap(a, b)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'intervals overlap within the day',
                path: ['intervals', j],
              });
            }
          }
        }
      }
    });
  });
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

// ─── Special days ────────────────────────────────────────────────────────

const dateStrSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => {
    const parts = s.split('-').map(Number);
    const y = parts[0] ?? NaN;
    const m = parts[1] ?? NaN;
    const d = parts[2] ?? NaN;
    return Number.isSafeInteger(y) && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }, 'not a plausible calendar date');

/** A special-day body (date comes from the URL path). `closed` cancels the day;
 * otherwise `intervals` replaces the weekly schedule for that date. */
export const upsertSpecialDayBodySchema = z
  .object({
    closed: z.boolean(),
    intervals: z.array(intervalSchema).max(3).optional(),
    note: z.string().max(200).nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.closed && d.intervals && d.intervals.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a closed special day cannot carry intervals',
        path: ['intervals'],
      });
    }
  });
export type UpsertSpecialDayBody = z.infer<typeof upsertSpecialDayBodySchema>;

export const specialDaySchema = z
  .object({
    date: dateStrSchema,
    closed: z.boolean(),
    intervals: z.array(intervalSchema).max(3).optional(),
    note: z.string().max(200).nullable().optional(),
  })
  .strict();
export type SpecialDay = z.infer<typeof specialDaySchema>;

// ─── Open-status ─────────────────────────────────────────────────────────

export const openStateSchema = z.enum(['open', 'closed', 'closing_soon', 'opening_soon']);
export type OpenState = z.infer<typeof openStateSchema>;

export const openStatusSchema = z
  .object({
    isOpen: z.boolean(),
    state: openStateSchema,
    nextChangeAt: z.string().nullable(),
    todayIntervals: z.array(intervalSchema),
  })
  .strict();
export type OpenStatus = z.infer<typeof openStatusSchema>;

// ─── Request / response bodies ───────────────────────────────────────────

export const replaceWeeklyHoursBodySchema = z.object({ weekly: weeklyHoursSchema }).strict();
export type ReplaceWeeklyHoursBody = z.infer<typeof replaceWeeklyHoursBodySchema>;

export const hoursResponseSchema = z
  .object({
    weekly: weeklyHoursSchema,
    specialDays: z.array(specialDaySchema),
    openStatus: openStatusSchema,
  })
  .strict();
export type HoursResponse = z.infer<typeof hoursResponseSchema>;

export const specialDaysListResponseSchema = z
  .object({ items: z.array(specialDaySchema) })
  .strict();
