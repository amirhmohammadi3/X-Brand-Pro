'use client';

import { forwardRef, useCallback, useId, useMemo, useState, type InputHTMLAttributes } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toDisplayDigits } from '../../../lib/forms/digits';
import { normalizeDigitsToAscii } from '../../../lib/calendar/calendar-system';
import { cn } from '../../../lib/cn';

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  /** Numeric value (null = empty). */
  value?: number | null;
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Show the Toman currency unit suffix and group thousands. */
  currency?: boolean;
  /** Group thousands with the locale separator. */
  groupThousands?: boolean;
  invalid?: boolean;
}

/**
 * `NumberInput` (F1.6). Accepts Persian (۰-۹), Arabic (٠-٩) and ASCII digits
 * and thousands separators while typing. Stores a `number | null`. On blur the
 * displayed text is re-formatted with locale thousands separators (and the
 * Toman unit when `currency`).
 *
 * The field is always `dir="ltr"` with `text-start` so digit entry is LTR even
 * inside an RTL page — this matches how Persian users type numbers.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    onChange,
    min,
    max,
    step,
    currency = false,
    groupThousands = true,
    invalid = false,
    className,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const locale = useLocale();
  const t = useTranslations('form.number');
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>('');

  const unit = currency ? t('currencyUnit') : null;

  // Display: while focused, show the raw draft; when not, show formatted.
  const displayValue = useMemo(() => {
    if (focused) return draft;
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    const shouldGroup = groupThousands || currency;
    if (shouldGroup) {
      const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
      return toDisplayDigits(formatted, locale);
    }
    return toDisplayDigits(String(value), locale);
  }, [focused, draft, value, groupThousands, currency, locale]);

  const syncDraftFromValue = useCallback(
    (v: number | null | undefined) => {
      if (v === null || v === undefined || Number.isNaN(v)) return '';
      return toDisplayDigits(String(v), locale);
    },
    [locale],
  );

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    setDraft(syncDraftFromValue(value));
    onFocus?.(e);
  };

  const clamp = (n: number | null): number | null => {
    if (n === null) return null;
    let result = n;
    if (min !== undefined && result < min) result = min;
    if (max !== undefined && result > max) result = max;
    return result;
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(false);
    const ascii = normalizeDigitsToAscii(draft).replace(/[,٬\s]/g, '');
    if (ascii === '') {
      onChange?.(null);
    } else {
      const parsed = Number(ascii);
      if (!Number.isNaN(parsed)) {
        onChange?.(clamp(parsed));
      }
    }
    onBlur?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow Persian/Arabic/ASCII digits and separators to pass through; the
    // value is parsed on blur.
    setDraft(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && step !== undefined) {
      e.preventDefault();
      const current = value ?? 0;
      onChange?.(clamp(current + step));
    } else if (e.key === 'ArrowDown' && step !== undefined) {
      e.preventDefault();
      const current = value ?? 0;
      onChange?.(clamp(current - step));
    }
  };

  return (
    <div className="relative flex w-full items-center">
      <input
        {...rest}
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-[var(--control-h)] w-full rounded-md border bg-surface px-3 text-start text-text',
          'placeholder:text-text-subtle',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          invalid ? 'border-danger' : 'border-border',
          unit ? 'pe-16' : '',
          className,
        )}
      />
      {unit ? (
        <span className="pointer-events-none absolute end-3 text-sm text-text-subtle">{unit}</span>
      ) : null}
    </div>
  );
});
