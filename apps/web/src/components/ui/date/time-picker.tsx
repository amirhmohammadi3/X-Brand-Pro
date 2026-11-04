'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { toDisplayDigits } from '../../../lib/forms/digits';
import { normalizeDigitsToAscii } from '../../../lib/calendar/calendar-system';
import { cn } from '../../../lib/cn';

export interface TimePickerProps {
  /** `HH:mm` (24h). null = empty. */
  value?: string | null;
  onChange: (value: string | null) => void;
  step?: number; // minutes
  min?: string | null; // HH:mm
  max?: string | null; // HH:mm
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
  className?: string;
}

function parseTime(text: string): { h: number; m: number } | null {
  const ascii = normalizeDigitsToAscii(text).trim();
  const m = /^([0-2]?\d)[:.\s]([0-5]?\d)$/.exec(ascii);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function clampTime(h: number, m: number, step: number): { h: number; m: number } {
  const total = h * 60 + m;
  const snapped = Math.round(total / step) * step;
  const nh = Math.floor(snapped / 60) % 24;
  const nm = snapped % 60;
  return { h: nh, m: nm };
}

function withinRange(
  h: number,
  m: number,
  min: string | null | undefined,
  max: string | null | undefined,
): boolean {
  const total = h * 60 + m;
  if (min) {
    const p = parseTime(min);
    if (p && total < p.h * 60 + p.m) return false;
  }
  if (max) {
    const p = parseTime(max);
    if (p && total > p.h * 60 + p.m) return false;
  }
  return true;
}

/**
 * `TimePicker` (F1.6). A typeable 24-hour `HH:mm` field. Accepts Persian/
 * Arabic/ASCII digits and `:`, `.` or space separators. `step` snaps the
 * minutes (default 1). ArrowUp/Down move by `step` minutes. Always `dir="ltr"`
 * for the field with `text-start`. The clock icon is decorative.
 */
export function TimePicker({
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled = false,
  invalid = false,
  'aria-label': ariaLabel,
  className,
}: TimePickerProps) {
  const locale = useLocale();
  const t = useTranslations('form.date');
  const id = useId();
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState(false);

  const display = useMemo(() => {
    if (draft) return draft;
    if (!value) return '';
    return toDisplayDigits(value, locale);
  }, [draft, value, locale]);

  const commit = useCallback(
    (text: string) => {
      if (!text.trim()) {
        onChange(null);
        setDraftError(false);
        return;
      }
      const parsed = parseTime(text);
      if (!parsed) {
        setDraftError(true);
        return;
      }
      const snapped = clampTime(parsed.h, parsed.m, step);
      if (!withinRange(snapped.h, snapped.m, min, max)) {
        setDraftError(true);
        return;
      }
      setDraftError(false);
      const formatted = `${String(snapped.h).padStart(2, '0')}:${String(snapped.m).padStart(2, '0')}`;
      onChange(formatted);
      setDraft(toDisplayDigits(formatted, locale));
    },
    [onChange, step, min, max, locale],
  );

  const handleStep = (dir: 1 | -1) => {
    const current = value ? parseTime(value) : { h: 0, m: 0 };
    if (!current) return;
    const total = current.h * 60 + current.m + dir * step;
    const wrapped = ((total % 1440) + 1440) % 1440;
    const nh = Math.floor(wrapped / 60);
    const nm = wrapped % 60;
    if (withinRange(nh, nm, min, max)) {
      const formatted = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
      onChange(formatted);
      setDraft(toDisplayDigits(formatted, locale));
    }
  };

  return (
    <div className={cn('relative flex w-full items-center', className)}>
      <input
        id={id}
        type="text"
        dir="ltr"
        inputMode="numeric"
        disabled={disabled}
        aria-label={ariaLabel ?? t('time')}
        aria-invalid={invalid || draftError || undefined}
        placeholder={toDisplayDigits('HH:mm', locale)}
        value={display}
        onChange={(e) => {
          setDraft(e.target.value);
          setDraftError(false);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            handleStep(1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            handleStep(-1);
          } else if (e.key === 'Enter') {
            commit(display);
          }
        }}
        className={cn(
          'h-[var(--control-h)] w-full rounded-md border bg-surface ps-9 pe-3 text-start text-text',
          'placeholder:text-text-subtle',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          invalid || draftError ? 'border-danger' : 'border-border',
        )}
      />
      <Clock
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute start-3 text-text-subtle"
      />
    </div>
  );
}
