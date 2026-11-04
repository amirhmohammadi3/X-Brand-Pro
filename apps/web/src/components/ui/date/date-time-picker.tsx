'use client';

import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';
import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';

export interface DateTimePickerProps {
  /** ISO `YYYY-MM-DDTHH:mm` (local). null = empty. */
  value?: string | null;
  onChange: (iso: string | null) => void;
  min?: string | null;
  max?: string | null;
  disabledDates?: ReadonlyArray<string>;
  step?: number;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/**
 * `DateTimePicker` (F1.6). Composes a `DatePicker` (date part) and a
 * `TimePicker` (time part) side by side. The value is a single ISO
 * `YYYY-MM-DDTHH:mm` string; editing either part updates it. Either part may
 * be empty (so you can set just the date first).
 */
export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  disabledDates,
  step = 1,
  disabled = false,
  invalid = false,
  className,
}: DateTimePickerProps) {
  const t = useTranslations('form.date');
  const dateId = useId();
  const timeId = useId();

  const datePart = value ? value.slice(0, 10) : null;
  const timePart = value ? value.slice(11, 16) || null : null;

  const dateMin = min ? min.slice(0, 10) : null;
  const dateMax = max ? max.slice(0, 10) : null;

  const handleDate = (iso: string | null) => {
    if (!iso) {
      onChange(null);
      return;
    }
    onChange(`${iso}T${timePart ?? '00:00'}`);
  };

  const handleTime = (time: string | null) => {
    if (!time) {
      // Keep the date, drop the time.
      onChange(datePart ? `${datePart}T00:00` : null);
      return;
    }
    onChange(`${datePart ?? '1970-01-01'}T${time}`);
  };

  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', className)}>
      <Field label={t('selectDate')} htmlFor={dateId}>
        <DatePicker
          value={datePart}
          onChange={handleDate}
          min={dateMin}
          max={dateMax}
          disabledDates={disabledDates}
          disabled={disabled}
          invalid={invalid}
          aria-label={t('selectDate')}
        />
      </Field>
      <Field label={t('time')} htmlFor={timeId}>
        <TimePicker
          value={timePart}
          onChange={handleTime}
          step={step}
          disabled={disabled}
          invalid={invalid}
          aria-label={t('time')}
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
