import { forwardRef, useCallback, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';
import { toDisplayDigits } from '../../../lib/forms/digits';
import { normalizeIranianPhone, toIranianNationalDisplay } from '../../../lib/forms/phone';

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  /** Canonical E.164 value, e.g. `+989123456789`. */
  value: string;
  /** Fired with the normalized E.164 string on change AND blur. */
  onValueChange: (value: string) => void;
  /** Force the input's visual direction; always LTR for phone numbers. */
  dir?: 'ltr';
}

/**
 * `PhoneInput` (F1.4). An Iranian mobile-number field that:
 *  - stores a canonical E.164 value (`+989123456789`);
 *  - displays the national form (`0912 345 6789`) with Persian digits in the
 *    `fa` locale and ASCII digits elsewhere;
 *  - always renders `dir="ltr"` so the number reads left-to-right even inside // rtl-ok
 *    an RTL page;
 *  - accepts pasted Persian/Arabic digits and normalizes them on change and
 *    on blur (so a half-typed value can be edited before committing).
 *
 * The component is controlled through `value`/`onValueChange` (not the native
 * `onChange`), so it drops straight into a react-hook-form `Controller`.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onValueChange, className, id, onBlur, ...rest },
  ref,
) {
  const t = useTranslations('validation');
  const locale = useLocale();
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  // The displayed text: national form, digits localized per locale.
  const display = value ? toDisplayDigits(toIranianNationalDisplay(value), locale) : '';

  const [draft, setDraft] = useState<string | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // While typing, keep a raw draft so the user can edit freely; only
      // normalize on blur. But we still push a normalized E.164 on change
      // so RHF validates against the canonical form.
      setDraft(e.target.value);
      onValueChange(normalizeIranianPhone(e.target.value));
    },
    [onValueChange],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const normalized = normalizeIranianPhone(e.target.value);
      onValueChange(normalized);
      setDraft(null);
      onBlur?.(e);
    },
    [onValueChange, onBlur],
  );

  const shown = draft ?? display;

  return (
    <input
      ref={ref}
      id={inputId}
      type="tel"
      inputMode="tel"
      dir="ltr"
      autoComplete="tel-national"
      aria-label={t('phone')}
      value={shown}
      onChange={handleChange}
      onBlur={handleBlur}
      className={cn(
        'w-full rounded-md border border-border bg-surface px-3 text-sm text-text',
        'h-[var(--control-h)] placeholder:text-text-subtle text-start',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...rest}
    />
  );
});
