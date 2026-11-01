import { getDate, getMonth, getYear, newDate, format as formatJalali } from 'date-fns-jalali';

/**
 * Formatting helpers (F1.1) — usable on the server and the client.
 *
 * The helpers are pure and take the locale explicitly through the
 * `createFormatters(locale)` factory: next-intl only exposes the active
 * locale synchronously inside React context (`useLocale()` on the client,
 * `await getLocale()` in server components), so a factory keeps every
 * function deterministic and unit-testable without global state.
 *
 * Rules implemented (prompt F1.1, AGENTS.md 8, DESIGN.md 6/11):
 *  - Persian digits for `fa` ONLY — every other locale gets ASCII digits;
 *  - `fa` dates use the Jalali calendar (date-fns-jalali) with Persian month
 *    names and Persian digits; other locales use Intl (Gregorian);
 *  - money is stored in Rials (`*_irr` bigint) and DISPLAYED as Toman
 *    (Rials / 10) with thousand separators and the unit from
 *    `common.currency.toman` — the caller passes the translated unit; a
 *    per-locale constant is the documented non-React fallback;
 *  - relative time via Intl.RelativeTimeFormat («۳ ساعت پیش» for fa);
 *  - week starts Saturday in `fa`;
 *  - display time zone defaults to `Asia/Tehran`; call sites pass the
 *    city/business time zone when one exists.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Tehran';

export type FormatStyle = 'short' | 'medium' | 'long';

export type Formatters = {
  /** 1234.5 → «۱٬۲۳۴٫۵» (fa) / «1,234.5» (en). */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  /** 0.42 → «۴۲٪» (fa) / «42%» (en). */
  formatPercent(value: number, options?: Intl.NumberFormatOptions): string;
  /** 1234500 IRR → «۱۲۳٬۴۵۰ تومان» (Toman = Rials/10, display-rounded). */
  formatMoneyIrr(amountIrr: number, options?: { unit?: string }): string;
  /** 1200 → «۱٫۲ هزار» (fa) / «1.2K» (en). */
  formatCompact(value: number): string;
  /** fa: Jalali («۱ فروردین ۱۴۰۵»), others: Gregorian («21 March 2026»). */
  formatDate(
    date: Date | number | string,
    style?: FormatStyle,
    options?: { timeZone?: string },
  ): string;
  /** Date + 24 h time («۱ فروردین ۱۴۰۵، ۱۲:۰۰»). */
  formatDateTime(
    date: Date | number | string,
    style?: FormatStyle,
    options?: { timeZone?: string },
  ): string;
  /** 24 h clock («۱۲:۰۰»). */
  formatTime(date: Date | number | string, options?: { timeZone?: string }): string;
  /** «۳ ساعت پیش» / «3 hours ago». */
  formatRelative(date: Date | number | string, options?: { now?: Date | number }): string;
};

/** ASCII 0-9 → Extended Arabic-Indic digits (fa display). */
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

export function toPersianDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

function toDateInput(date: Date | number | string): Date {
  return date instanceof Date ? date : new Date(date);
}

/**
 * Returns a Date whose LOCAL wall-clock reads `date`'s wall-clock in
 * `timeZone` (the standard offset-compensation trick — date-fns-jalali has no
 * timeZone option and no TZDate export). Deterministic regardless of the
 * process time zone; DST circularity is documented in DECISIONS and
 * irrelevant for the shipped locales (Iran has no DST since 2022).
 */
function wallTimeInTimeZone(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value === undefined ? 0 : Number(value);
  };
  // Some ICU versions report midnight as hour 24 with hour12: false.
  const year = get('year');
  const month = get('month') - 1;
  const day = get('day');
  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');
  const wallAsUtc = Date.UTC(year, month, day, hour, minute, second);
  const localOffsetMs =
    new Date(year, month, day, hour, minute, second).getTime() -
    new Date(Date.UTC(year, month, day, hour, minute, second)).getTime();
  return new Date(wallAsUtc - localOffsetMs);
}

/**
 * Jalali parts { jy, jm, jd } of a date, in the given display time zone.
 * Companion of `toIsoDateFromJalali` for the date picker (F1.6).
 */
export function fromIsoToJalaliParts(
  date: Date | number | string,
  timeZone: string = DEFAULT_TIME_ZONE,
): { jy: number; jm: number; jd: number } {
  const wall = wallTimeInTimeZone(toDateInput(date), timeZone);
  return { jy: getYear(wall), jm: getMonth(wall) + 1, jd: getDate(wall) };
}

/**
 * ISO Gregorian date (`YYYY-MM-DD`) from Jalali parts. Round-trips with
 * `fromIsoToJalaliParts` (verified for leap-year edge 1403-12-30).
 */
export function toIsoDateFromJalali(jy: number, jm: number, jd: number): string {
  const gregorian = newDate(jy, jm - 1, jd);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${gregorian.getFullYear()}-${pad(gregorian.getMonth() + 1)}-${pad(gregorian.getDate())}`;
}

/**
 * 0 = Sunday … 6 = Saturday (JS `getDay` convention). `fa` starts the week
 * on Saturday; `en` on Sunday. Uses `Intl.Locale.getWeekInfo` when the
 * runtime has it, with a locale map fallback for older engines.
 */
export function firstDayOfWeek(locale: string): number {
  try {
    const weekInfo = (
      new Intl.Locale(locale) as unknown as {
        getWeekInfo?: () => { firstDay: number };
      }
    ).getWeekInfo?.();
    if (weekInfo) {
      const isoDay = weekInfo.firstDay; // ISO: 1 = Monday … 7 = Sunday
      return isoDay === 7 ? 0 : isoDay;
    }
  } catch {
    // Fall through to the static map.
  }
  return locale === 'fa' ? 6 : 0;
}

/** Non-React fallback for the money unit; UI passes `t('common.currency.toman')`. */
const FALLBACK_MONEY_UNIT: Readonly<Record<string, string>> = {
  fa: 'تومان',
};

function moneyUnit(locale: string, explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return FALLBACK_MONEY_UNIT[locale] ?? 'Toman';
}

function dateTimeSeparator(locale: string): string {
  return locale === 'fa' ? '، ' : ', ';
}

const JALALI_DATE_PATTERN: Readonly<Record<FormatStyle, string>> = {
  short: 'yyyy/MM/dd',
  medium: 'd MMMM yyyy',
  long: 'EEEE d MMMM yyyy',
};

type IntlDateOptions = Intl.DateTimeFormatOptions;

const GREGORIAN_DATE_OPTIONS: Readonly<Record<FormatStyle, IntlDateOptions>> = {
  short: { year: 'numeric', month: '2-digit', day: '2-digit' },
  medium: { year: 'numeric', month: 'long', day: 'numeric' },
  long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
};

export function createFormatters(locale: string, options: { timeZone?: string } = {}): Formatters {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const isFa = locale === 'fa';

  function formatNumber(value: number, numberOptions?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(locale, numberOptions).format(value);
  }

  function formatDate(
    date: Date | number | string,
    style: FormatStyle = 'medium',
    dateOptions?: { timeZone?: string },
  ): string {
    const zone = dateOptions?.timeZone ?? timeZone;
    if (isFa) {
      const wall = wallTimeInTimeZone(toDateInput(date), zone);
      return toPersianDigits(formatJalali(wall, JALALI_DATE_PATTERN[style]));
    }
    return new Intl.DateTimeFormat(locale, {
      ...GREGORIAN_DATE_OPTIONS[style],
      timeZone: zone,
    }).format(toDateInput(date));
  }

  function formatTime(date: Date | number | string, timeOptions?: { timeZone?: string }): string {
    const zone = timeOptions?.timeZone ?? timeZone;
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: zone,
    }).format(toDateInput(date));
  }

  function formatDateTime(
    date: Date | number | string,
    style: FormatStyle = 'medium',
    dateTimeOptions?: { timeZone?: string },
  ): string {
    const zone = dateTimeOptions?.timeZone ?? timeZone;
    return `${formatDate(date, style, { timeZone: zone })}${dateTimeSeparator(locale)}${formatTime(date, { timeZone: zone })}`;
  }

  function formatRelative(
    date: Date | number | string,
    relativeOptions?: { now?: Date | number },
  ): string {
    const now = relativeOptions?.now !== undefined ? toDateInput(relativeOptions.now) : new Date();
    const target = toDateInput(date);
    const diffSeconds = Math.round((target.getTime() - now.getTime()) / 1000);
    const absolute = Math.abs(diffSeconds);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (absolute < 60) return rtf.format(diffSeconds, 'second');
    if (absolute < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
    if (absolute < 86_400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
    if (absolute < 604_800) return rtf.format(Math.round(diffSeconds / 86_400), 'day');
    if (absolute < 2_629_800) return rtf.format(Math.round(diffSeconds / 604_800), 'week');
    if (absolute < 31_557_600) return rtf.format(Math.round(diffSeconds / 2_629_800), 'month');
    return rtf.format(Math.round(diffSeconds / 31_557_600), 'year');
  }

  return {
    formatNumber,
    formatPercent: (value, numberOptions) =>
      formatNumber(value, { style: 'percent', ...numberOptions }),
    formatMoneyIrr: (amountIrr, moneyOptions) => {
      // Display-only rounding of odd Rials — amounts are never computed from
      // the rendered string (money math stays on integer Rials, AGENTS.md 6).
      const toman = amountIrr / 10;
      const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(toman);
      return `${formatted} ${moneyUnit(locale, moneyOptions?.unit)}`;
    },
    formatCompact: (value) =>
      new Intl.NumberFormat(locale, { notation: 'compact', compactDisplay: 'short' }).format(value),
    formatDate,
    formatDateTime,
    formatTime,
    formatRelative,
  };
}
