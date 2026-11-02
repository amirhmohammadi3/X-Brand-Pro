import { forwardRef, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Search } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { IconButton } from '../icon-button';

export type InputType = 'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'number';

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  type?: InputType;
  /** Logical-direction override ('rtl' | 'ltr'); defaults to inherited. */
  dir?: 'rtl' | 'ltr';
  /** Element rendered before the input text (logical padding handles side). */
  startAdornment?: ReactNode;
  /** Element rendered after the input text. */
  endAdornment?: ReactNode;
  /** Force the password show/hide toggle on/off (only affects type=password). */
  showPasswordToggle?: boolean;
  /** Accessible label passed through to the password visibility button. */
}

/**
 * `Input` (F1.4). The base text control used by every form field.
 *
 * Variants:
 *  - `password` renders a show/hide toggle button with a localized, accessible
 *    name (`form.showPassword` / `form.hidePassword`). The toggle is a real
 *    `<button type="button">` so it never submits the form.
 *  - `search` renders a leading search icon.
 *  - `startAdornment` / `endAdornment` render before/after the value; the
 *    input uses logical padding (`ps-`/`pe-`) so it mirrors in RTL.
 *
 * `dir` is honored literally (phone/OTP inputs force `ltr`); everything else
 * inherits the document direction.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    type = 'text',
    dir,
    className,
    startAdornment,
    endAdornment,
    showPasswordToggle = true,
    id,
    ...rest
  },
  ref,
) {
  const t = useTranslations('form');
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;
  const hasStart = type === 'search' || startAdornment !== undefined;

  return (
    <span className="relative inline-flex items-center w-full">
      {hasStart ? (
        <span
          className="pointer-events-none absolute inset-inline-start-0 flex items-center ps-3 text-text-subtle"
          aria-hidden="true"
        >
          {type === 'search' ? <Search size={16} /> : startAdornment}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        type={effectiveType}
        dir={dir}
        className={cn(
          'w-full rounded-md border border-border bg-surface px-3 text-sm text-text',
          'h-[var(--control-h)] placeholder:text-text-subtle',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'aria-[invalid=true]:border-danger',
          hasStart && 'ps-9',
          (endAdornment !== undefined || (isPassword && showPasswordToggle)) && 'pe-9',
          className,
        )}
        {...rest}
      />
      {isPassword && showPasswordToggle ? (
        <span className="absolute inset-inline-end-0 flex items-center pe-1">
          <IconButton
            type="button"
            icon={revealed ? EyeOff : Eye}
            aria-label={revealed ? t('hidePassword') : t('showPassword')}
            aria-pressed={revealed}
            onClick={() => setRevealed((v) => !v)}
            tabIndex={-1}
            className="text-text-subtle hover:text-text"
          />
        </span>
      ) : null}
      {!isPassword && endAdornment !== undefined ? (
        <span
          className="absolute inset-inline-end-0 flex items-center pe-3 text-text-subtle"
          aria-hidden="true"
        >
          {endAdornment}
        </span>
      ) : null}
    </span>
  );
});
