import { getTranslations } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui';
import { firstDayOfWeek, toPersianDigits, DEFAULT_TIME_ZONE } from '@/lib/format';
import type { HoursResponse, OpenState, WeeklyDay } from '@app/contracts';

/**
 * Business hours section (F4.1). Renders the weekly schedule as a 7-row list
 * ordered by the locale's first weekday (Saturday for fa, Sunday for en —
 * `firstDayOfWeek`), with today's row highlighted and the open-now state
 * derived from the B4.9 aggregate's `hours.openStatus`.
 *
 * Server component: `getTranslations('businessPage')` is awaited here so the
 * section is self-contained (the page does not need to thread a `t` fn down).
 * Weekday NAMES are a locale constant (the repo avoids `Intl` for fa because
 * jsdom's ICU is uneven across Node builds — same precedent as
 * `FALLBACK_MONEY_UNIT` in lib/format.ts). Times are `HH:mm` strings the API
 * already normalized; for fa they are run through `toPersianDigits`.
 */

const WEEKDAY_NAMES: Readonly<Record<string, Record<number, string>>> = {
  fa: {
    1: 'دوشنبه',
    2: 'سه‌شنبه',
    3: 'چهارشنبه',
    4: 'پنج‌شنبه',
    5: 'جمعه',
    6: 'شنبه',
    7: 'یکشنبه',
  },
  en: {
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
    7: 'Sunday',
  },
};

/** Open-now pill metadata shared by the hero pill and the hours section. */
export const OPEN_STATE_META: Record<OpenState, { labelKey: string; variant: BadgeVariant }> = {
  open: { labelKey: 'openNow', variant: 'success' },
  closing_soon: { labelKey: 'closingSoon', variant: 'warning' },
  opening_soon: { labelKey: 'openingSoon', variant: 'warning' },
  closed: { labelKey: 'closed', variant: 'neutral' },
};

/** ISO weekday of "now" in the business's timezone (Asia/Tehran). 1=Mon … 7=Sun. */
function todayIsoWeekday(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: DEFAULT_TIME_ZONE });
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[fmt.format(new Date())] ?? 1;
}

/** 1..7 starting at the locale's first weekday (firstDayOfWeek → ISO).
 * Exported for the unit test (Saturday-first for fa, Sunday-first for en). */
export function orderedWeekdays(firstDay: number): number[] {
  const isoFirst = firstDay === 0 ? 7 : firstDay; // firstDayOfWeek: 0=Sun → ISO 7
  return Array.from({ length: 7 }, (_, i) => ((isoFirst - 1 + i) % 7) + 1);
}

export interface BusinessHoursProps {
  hours: HoursResponse;
  locale: string;
}

export async function BusinessHours({ hours, locale }: BusinessHoursProps) {
  const t = await getTranslations('businessPage');
  const names = (WEEKDAY_NAMES[locale] ?? WEEKDAY_NAMES.en) as Record<number, string>;
  const today = todayIsoWeekday();
  const byWeekday = new Map<number, WeeklyDay>(hours.weekly.map((d) => [d.weekday, d]));
  const intervalSep = locale === 'fa' ? '، ' : ', ';
  const fmtTime = (s: string): string => (locale === 'fa' ? toPersianDigits(s) : s);

  if (hours.weekly.length === 0) {
    return <p className="text-sm text-muted">{t('hours.noSchedule')}</p>;
  }

  return (
    <ul data-testid="business-hours-table" className="flex flex-col divide-y divide-border-subtle">
      {orderedWeekdays(firstDayOfWeek(locale)).map((iso) => {
        const day = byWeekday.get(iso);
        const isToday = iso === today;
        let cell: string;
        if (!day) {
          cell = t('hours.closed');
        } else if (day.allDay === true) {
          cell = t('hours.allDay');
        } else {
          cell = (day.intervals ?? [])
            .map((iv) => `${fmtTime(iv.open)}–${fmtTime(iv.close)}`)
            .join(intervalSep);
        }
        return (
          <li
            key={iso}
            className={`flex items-center justify-between gap-4 py-2 text-sm ${
              isToday ? 'font-semibold text-text' : 'text-muted'
            }`}
            data-testid="business-hours-row"
            data-today={isToday ? 'true' : 'false'}
            data-weekday={iso}
          >
            <span className="flex items-center gap-2">
              {names[iso]}
              {isToday ? (
                <Badge variant="primary" data-testid="business-hours-today-badge">
                  {t('hours.today')}
                </Badge>
              ) : null}
            </span>
            <span className="tabular-nums">{cell}</span>
          </li>
        );
      })}
    </ul>
  );
}
