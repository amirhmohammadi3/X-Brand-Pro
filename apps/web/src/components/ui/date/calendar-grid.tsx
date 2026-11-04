'use client';

import { useMemo, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getCalendarSystem,
  atMidnight,
  dateToIso,
  type CalendarCell,
  type MonthGrid,
} from '../../../lib/calendar/calendar-system';
import { cn } from '../../../lib/cn';
import { IconButton } from '../icon-button';

export interface CalendarGridProps {
  /** Gregorian display-calendar year/month being viewed. */
  viewYear: number;
  viewMonth: number; // 1-12 in the DISPLAY calendar
  selected?: Date | null;
  min?: Date | null;
  max?: Date | null;
  disabledDates?: ReadonlyArray<string>; // ISO YYYY-MM-DD
  onPick: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  className?: string;
}

function isDisabled(
  cell: CalendarCell,
  min: Date | null,
  max: Date | null,
  disabled: Set<string>,
): boolean {
  if (disabled.has(cell.iso)) return true;
  if (min && cell.date < atMidnight(min)) return true;
  if (max && cell.date > atMidnight(max)) return true;
  return false;
}

/**
 * `CalendarGrid` (F1.6). The shared month view used by DatePicker /
 * DateRangePicker. Renders a WAI-ARIA `grid` with `gridcell`s, full keyboard
 * navigation, and a non-color cue for the selected day (a ring + bold weight).
 *
 * RTL arrow rule: arrows follow VISUAL direction. In an RTL grid the visual
 * order is mirrored, so ArrowRight moves to the PREVIOUS day and ArrowLeft to
 * the NEXT day — we detect `dir="rtl"` at runtime and swap.
 */
export function CalendarGrid({
  viewYear,
  viewMonth,
  selected,
  min,
  max,
  disabledDates = [],
  onPick,
  onPrevMonth,
  onNextMonth,
  className,
}: CalendarGridProps) {
  const locale = useLocale();
  const t = useTranslations('form.date');
  const sys = getCalendarSystem(locale);
  const weekStart = sys.defaultWeekStart;

  const grid: MonthGrid = useMemo(
    () => sys.getMonthGrid(viewYear, viewMonth, weekStart),
    [sys, viewYear, viewMonth, weekStart],
  );

  const weekdayNames = useMemo(() => sys.getWeekdayNames(weekStart, 'narrow'), [sys, weekStart]);

  const disabledSet = useMemo(() => new Set(disabledDates), [disabledDates]);
  const selectedIso = selected ? dateToIso(selected) : null;

  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  const onCellKeyDown = (
    e: KeyboardEvent<HTMLDivElement>,
    cell: CalendarCell,
    rIdx: number,
    cIdx: number,
  ) => {
    let nextR = rIdx;
    let nextC = cIdx;
    switch (e.key) {
      case 'ArrowRight':
        nextC = isRtl ? cIdx - 1 : cIdx + 1;
        break;
      case 'ArrowLeft':
        nextC = isRtl ? cIdx + 1 : cIdx - 1;
        break;
      case 'ArrowDown':
        nextR = rIdx + 1;
        break;
      case 'ArrowUp':
        nextR = rIdx - 1;
        break;
      case 'Home':
        nextC = 0;
        break;
      case 'End':
        nextC = 6;
        break;
      case 'PageUp':
        e.preventDefault();
        onPrevMonth();
        return;
      case 'PageDown':
        e.preventDefault();
        onNextMonth();
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!isDisabled(cell, min ?? null, max ?? null, disabledSet)) onPick(cell.date);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (nextC < 0) {
      nextC = 6;
      nextR -= 1;
    }
    if (nextC > 6) {
      nextC = 0;
      nextR += 1;
    }
    if (nextR < 0) {
      onPrevMonth();
      return;
    }
    if (nextR > 5) {
      onNextMonth();
      return;
    }
    const target = grid.weeks[nextR]?.[nextC];
    if (target) {
      const el = document.querySelector<HTMLElement>(`[data-cell="${target.iso}"]`);
      el?.focus();
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <IconButton
          icon={ChevronRight}
          aria-label={t('prevMonth')}
          onClick={onPrevMonth}
          className="rtl:hidden"
        />
        <IconButton
          icon={ChevronLeft}
          aria-label={t('prevMonth')}
          onClick={onPrevMonth}
          className="hidden rtl:flex"
        />
        <span className="text-sm font-semibold text-text" aria-live="polite">
          {grid.monthName} {viewYear}
        </span>
        <IconButton
          icon={ChevronLeft}
          aria-label={t('nextMonth')}
          onClick={onNextMonth}
          className="rtl:hidden"
        />
        <IconButton
          icon={ChevronRight}
          aria-label={t('nextMonth')}
          onClick={onNextMonth}
          className="hidden rtl:flex"
        />
      </div>

      <div role="grid" aria-label={t('selectDate')} className="grid grid-cols-7 gap-1">
        {weekdayNames.map((name, i) => (
          <div
            key={i}
            role="columnheader"
            className="py-1 text-center text-xs font-medium text-text-subtle"
          >
            {name}
          </div>
        ))}
        {grid.weeks.map((week, rIdx) =>
          week.map((cell, cIdx) => {
            const disabled = isDisabled(cell, min ?? null, max ?? null, disabledSet);
            const isSelected = selectedIso === cell.iso;
            return (
              <div
                key={`${rIdx}-${cIdx}`}
                role="gridcell"
                tabIndex={isSelected ? 0 : -1}
                data-cell={cell.iso}
                data-selected={isSelected || undefined}
                data-disabled={disabled || undefined}
                data-in-month={cell.inMonth || undefined}
                aria-selected={isSelected}
                aria-disabled={disabled}
                aria-label={`${cell.day} ${grid.monthName} ${viewYear}${isSelected ? `, ${t('selected')}` : ''}${disabled ? `, ${t('disabledDate')}` : ''}`}
                onClick={() => {
                  if (!disabled && cell.inMonth) onPick(cell.date);
                }}
                onKeyDown={(e) => onCellKeyDown(e, cell, rIdx, cIdx)}
                className={cn(
                  'flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-sm',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                  !cell.inMonth && 'text-text-subtle/40',
                  cell.inMonth && !disabled && 'text-text hover:bg-surface-alt',
                  disabled && 'cursor-not-allowed text-text-subtle/40',
                  isSelected &&
                    'bg-primary font-bold text-on-primary ring-2 ring-primary ring-offset-2 ring-offset-surface',
                  cell.isWeekend && cell.inMonth && !isSelected && 'text-text-subtle',
                )}
              >
                {cell.day}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
