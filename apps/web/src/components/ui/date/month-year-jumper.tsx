'use client';

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getCalendarSystem, type CalendarParts } from '../../../lib/calendar/calendar-system';
import { cn } from '../../../lib/cn';
import { IconButton } from '../icon-button';
import { Button } from '../button';

export interface MonthYearJumperProps {
  /** Display-calendar { year, month } currently in view. */
  value: CalendarParts;
  onChange: (parts: CalendarParts) => void;
  minYear?: number;
  maxYear?: number;
  className?: string;
}

/**
 * `MonthYearJumper` (F1.6). A compact control to jump the calendar to a
 * specific month/year without paging month-by-month: prev/next year buttons,
 * a year stepper, and a 12-button month grid (in the display calendar's
 * language). Used by map/filter screens that need "show me next March".
 */
export function MonthYearJumper({
  value,
  onChange,
  minYear,
  maxYear,
  className,
}: MonthYearJumperProps) {
  const locale = useLocale();
  const t = useTranslations('form.date');
  const sys = getCalendarSystem(locale);
  const id = useId();
  const [editingYear, setEditingYear] = useState(value.year);

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        index: i + 1,
        name: sys.getMonthName(i + 1, 'short'),
      })),
    [sys],
  );

  const canPrevYear = minYear === undefined || editingYear > minYear;
  const canNextYear = maxYear === undefined || editingYear < maxYear;

  const stepYear = (dir: number) => {
    const next = editingYear + dir;
    if ((minYear !== undefined && next < minYear) || (maxYear !== undefined && next > maxYear))
      return;
    setEditingYear(next);
    onChange({ ...value, year: next });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <IconButton
          icon={ChevronRight}
          aria-label={t('prevMonth')}
          onClick={() => stepYear(-1)}
          disabled={!canPrevYear}
          className="rtl:hidden"
        />
        <IconButton
          icon={ChevronLeft}
          aria-label={t('prevMonth')}
          onClick={() => stepYear(-1)}
          disabled={!canPrevYear}
          className="hidden rtl:flex"
        />
        <span className="text-sm font-semibold text-text" aria-live="polite">
          {editingYear}
        </span>
        <IconButton
          icon={ChevronLeft}
          aria-label={t('nextMonth')}
          onClick={() => stepYear(1)}
          disabled={!canNextYear}
          className="rtl:hidden"
        />
        <IconButton
          icon={ChevronRight}
          aria-label={t('nextMonth')}
          onClick={() => stepYear(1)}
          disabled={!canNextYear}
          className="hidden rtl:flex"
        />
      </div>
      <div role="group" aria-label={t('jumpToMonth')} className="grid grid-cols-3 gap-1">
        {months.map((m) => {
          const active = value.year === editingYear && value.month === m.index;
          return (
            <Button
              key={m.index}
              id={`${id}-m${m.index}`}
              type="button"
              variant={active ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={active}
              onClick={() => onChange({ year: editingYear, month: m.index, day: 1 })}
              className="text-xs"
            >
              {m.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
