'use client';

import { useId, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { isoToDate } from '../../../lib/calendar/calendar-system';
import { cn } from '../../../lib/cn';
import { DatePicker } from './date-picker';

export interface DateRangePickerProps {
  /** `[startISO, endISO]` — either may be null. */
  value: [string | null, string | null];
  onChange: (value: [string | null, string | null]) => void;
  min?: string | null;
  max?: string | null;
  disabledDates?: ReadonlyArray<string>;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/**
 * `DateRangePicker` (F1.6). Two linked `DatePicker`s: the start picker's `max`
 * is the current end (so you can't pick a start after the end), and the end
 * picker's `min` is the current start. Both honor the shared `min`/`max`/
 * `disabledDates`. This composes the single-date picker rather than
 * re-implementing a calendar, so it inherits all keyboard + RTL behavior.
 */
export function DateRangePicker({
  value,
  onChange,
  min,
  max,
  disabledDates,
  disabled = false,
  invalid = false,
  className,
}: DateRangePickerProps) {
  const t = useTranslations('form.date');
  const startId = useId();
  const endId = useId();
  const [start, end] = value;

  const startMax = useMemo(() => end ?? max ?? null, [end, max]);
  const endMin = useMemo(() => start ?? min ?? null, [start, min]);

  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', className)}>
      <Field label={t('startDate')} htmlFor={startId}>
        <DatePicker
          value={start}
          onChange={(iso) => onChange([iso, end])}
          min={min}
          max={startMax}
          disabledDates={disabledDates}
          disabled={disabled}
          invalid={invalid}
          aria-label={t('startDate')}
        />
      </Field>
      <span className="self-center text-text-subtle sm:mx-1" aria-hidden="true">
        —
      </span>
      <Field label={t('endDate')} htmlFor={endId}>
        <DatePicker
          value={end}
          onChange={(iso) => onChange([start, iso])}
          min={endMin}
          max={max}
          disabledDates={disabledDates}
          disabled={disabled}
          invalid={invalid}
          aria-label={t('endDate')}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-subtle">
        {label}
      </label>
      {children}
    </div>
  );
}

// Re-export for callers that want to validate the order.
export { isoToDate };
