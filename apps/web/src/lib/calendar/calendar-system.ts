import {
  addMonths as jalaliAddMonths,
  format as jalaliFormat,
  isSameDay as jalaliIsSameDay,
  newDate as newJalaliDate,
  getYear as jalaliGetYear,
  getMonth as jalaliGetMonth,
  getDate as jalaliGetDate,
  getDay as jalaliGetDay,
  parse as jalaliParse,
} from 'date-fns-jalali';

/**
 * Calendar engine (F1.6). Two implementations share one interface:
 *  - `jalali` — used when the locale is `fa` (Persian calendar via date-fns-jalali);
 *  - `gregorian` — every other locale.
 *
 * The canonical store is ALWAYS a JavaScript `Date` (local midnight) or an ISO
 * `YYYY-MM-DD` string in the GREGORIAN calendar. Conversion to/from the
 * display calendar (Jalali) happens ONLY inside this engine. Components never
 * see Jalali parts.
 *
 * Month grids always contain 6 rows (42 cells) for a stable height. Week start
 * is configurable: 0 = Sunday … 6 = Saturday. Defaults: Saturday (6) for
 * Jalali, Monday (1) for Gregorian.
 */

export type CalendarId = 'jalali' | 'gregorian';

export interface CalendarParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface CalendarCell {
  /** Gregorian JS Date at local midnight — the canonical store. */
  date: Date;
  /** ISO `YYYY-MM-DD`. */
  iso: string;
  /** Day-of-month in the DISPLAY calendar (1-31). */
  day: number;
  /** Belongs to the displayed month. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

export interface MonthGrid {
  year: number; // display calendar year
  month: number; // 1-12 display calendar month
  monthName: string;
  weeks: CalendarCell[][];
}

export interface CalendarSystem {
  readonly id: CalendarId;
  /** Default week start (0=Sun…6=Sat) for this calendar. */
  readonly defaultWeekStart: number;
  getMonthGrid(year: number, month: number, weekStart?: number): MonthGrid;
  getMonthName(month: number, style?: 'short' | 'long'): string;
  getWeekdayNames(weekStart?: number, style?: 'narrow' | 'short'): string[];
  /** Display-calendar parts { year, month, day } of a Gregorian Date. */
  fromDate(date: Date): CalendarParts;
  /** Gregorian local-midnight Date from display-calendar parts. */
  toDate(parts: CalendarParts): Date;
  addMonths(date: Date, amount: number): Date;
  isSameDay(a: Date, b: Date): boolean;
  isWeekend(date: Date): boolean;
  /** Display-calendar format, e.g. `yyyy/MM/dd` → `1405/01/01` (Jalali). */
  format(date: Date, pattern: string): string;
  /** Parse display-calendar text; returns a Gregorian Date or null. */
  parse(text: string, pattern: string): Date | null;
}

// ---------------------------------------------------------------------------
// Helpers shared by both systems.
// ---------------------------------------------------------------------------

/** Persian/Arabic-Indic digits → ASCII 0-9, plus separator normalization. */
export function normalizeDigitsToAscii(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Local-midnight Date for a Gregorian ISO `YYYY-MM-DD`. */
export function isoToDate(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

/** ISO `YYYY-MM-DD` from a Date's LOCAL wall-clock (no TZ drift). */
export function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-midnight Date (drops time). */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildGrid(
  sys: CalendarSystem,
  firstOfMonth: Date,
  weekStart: number,
  today: Date,
): CalendarCell[][] {
  const firstWeekday = firstOfMonth.getDay(); // 0=Sun…6=Sat
  const lead = (firstWeekday - weekStart + 7) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - lead);

  const weeks: CalendarCell[][] = [];
  let cursor = atMidnight(start);
  for (let row = 0; row < 6; row++) {
    const week: CalendarCell[] = [];
    for (let col = 0; col < 7; col++) {
      const parts = sys.fromDate(cursor);
      week.push({
        date: new Date(cursor),
        iso: dateToIso(cursor),
        day: parts.day,
        inMonth:
          parts.month === sys.fromDate(firstOfMonth).month &&
          parts.year === sys.fromDate(firstOfMonth).year,
        isToday: sys.isSameDay(cursor, today),
        isWeekend: sys.isWeekend(cursor),
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// Jalali system
// ---------------------------------------------------------------------------

const JALALI_MONTHS_LONG = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];
const JALALI_MONTHS_SHORT = JALALI_MONTHS_LONG; // Persian month names have no short form in common use.

// Weekday names indexed by JS getDay (0=Sun…6=Sat).
const JALALI_WEEKDAYS_SHORT = [
  'یک‌شنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
  'شنبه',
];
const JALALI_WEEKDAYS_NARROW = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];

class JalaliCalendar implements CalendarSystem {
  readonly id = 'jalali' as const;
  readonly defaultWeekStart = 6; // Saturday

  fromDate(date: Date): CalendarParts {
    return {
      year: jalaliGetYear(date),
      month: jalaliGetMonth(date) + 1,
      day: jalaliGetDate(date),
    };
  }

  toDate(parts: CalendarParts): Date {
    return newJalaliDate(parts.year, parts.month - 1, parts.day);
  }

  addMonths(date: Date, amount: number): Date {
    return jalaliAddMonths(date, amount);
  }

  isSameDay(a: Date, b: Date): boolean {
    return jalaliIsSameDay(a, b);
  }

  isWeekend(date: Date): boolean {
    // Friday is the weekend in Iran.
    return jalaliGetDay(date) === 5;
  }

  format(date: Date, pattern: string): string {
    return jalaliFormat(date, pattern);
  }

  parse(text: string, pattern: string): Date | null {
    // date-fns-jalali only accepts ASCII digits; normalize Persian/Arabic.
    const ascii = normalizeDigitsToAscii(text);
    try {
      const parsed = jalaliParse(ascii, pattern, new Date());
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  getMonthName(month: number, style: 'short' | 'long' = 'long'): string {
    const names = style === 'short' ? JALALI_MONTHS_SHORT : JALALI_MONTHS_LONG;
    return names[(month - 1 + 12) % 12] ?? '';
  }

  getWeekdayNames(weekStart?: number, style: 'narrow' | 'short' = 'short'): string[] {
    const ws = weekStart ?? this.defaultWeekStart;
    const names = style === 'narrow' ? JALALI_WEEKDAYS_NARROW : JALALI_WEEKDAYS_SHORT;
    const ordered: string[] = [];
    for (let i = 0; i < 7; i++) {
      ordered.push(names[(ws + i) % 7] as string);
    }
    return ordered;
  }

  getMonthGrid(year: number, month: number, weekStart?: number): MonthGrid {
    const ws = weekStart ?? this.defaultWeekStart;
    const firstOfMonth = newJalaliDate(year, month - 1, 1);
    const weeks = buildGrid(this, firstOfMonth, ws, atMidnight(new Date()));
    return {
      year,
      month,
      monthName: this.getMonthName(month),
      weeks,
    };
  }
}

// ---------------------------------------------------------------------------
// Gregorian system
// ---------------------------------------------------------------------------

class GregorianCalendar implements CalendarSystem {
  readonly id = 'gregorian' as const;
  readonly defaultWeekStart = 1; // Monday

  fromDate(date: Date): CalendarParts {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    };
  }

  toDate(parts: CalendarParts): Date {
    return new Date(parts.year, parts.month - 1, parts.day);
  }

  addMonths(date: Date, amount: number): Date {
    const next = new Date(date);
    next.setMonth(next.getMonth() + amount);
    return next;
  }

  isSameDay(a: Date, b: Date): boolean {
    return dateToIso(a) === dateToIso(b);
  }

  isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  format(date: Date, pattern: string): string {
    // Minimal pattern support for the picker: yyyy-MM-dd, yyyy/MM/dd.
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return pattern.replace(/yyyy/g, String(y)).replace(/MM/g, m).replace(/dd/g, d);
  }

  parse(text: string, pattern: string): Date | null {
    // Build a regex from the pattern, capturing y/m/d positions.
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRe = /(yyyy|MM|dd)/g;
    const order: string[] = [];
    const regexStr = escaped.replace(tokenRe, (tok) => {
      order.push(tok);
      return '(\\d{1,4})';
    });
    const match = new RegExp(`^${regexStr}$`).exec(text.trim());
    if (!match) return null;
    const parts: CalendarParts = { year: 0, month: 1, day: 1 };
    order.forEach((tok, i) => {
      const v = Number(match[i + 1]);
      if (tok === 'yyyy') parts.year = v;
      else if (tok === 'MM') parts.month = v;
      else if (tok === 'dd') parts.day = v;
    });
    if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
    return this.toDate(parts);
  }

  getMonthName(month: number, _style: 'short' | 'long' = 'long'): string {
    const names = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return names[(month - 1 + 12) % 12] ?? '';
  }

  getWeekdayNames(weekStart?: number, style: 'narrow' | 'short' = 'short'): string[] {
    const ws = weekStart ?? this.defaultWeekStart;
    const short = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const narrow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const names = style === 'narrow' ? narrow : short;
    const ordered: string[] = [];
    for (let i = 0; i < 7; i++) {
      ordered.push(names[(ws + i) % 7] as string);
    }
    return ordered;
  }

  getMonthGrid(year: number, month: number, weekStart?: number): MonthGrid {
    const ws = weekStart ?? this.defaultWeekStart;
    const firstOfMonth = new Date(year, month - 1, 1);
    const weeks = buildGrid(this, firstOfMonth, ws, atMidnight(new Date()));
    return {
      year,
      month,
      monthName: this.getMonthName(month),
      weeks,
    };
  }
}

export const jalaliCalendar: CalendarSystem = new JalaliCalendar();
export const gregorianCalendar: CalendarSystem = new GregorianCalendar();

/** Pick the calendar system for a locale: `fa` → Jalali, anything else → Gregorian. */
export function getCalendarSystem(locale: string): CalendarSystem {
  return locale === 'fa' ? jalaliCalendar : gregorianCalendar;
}
