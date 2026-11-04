import { useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';
import { toAsciiDigits } from '../../../lib/forms/digits';

export interface OtpInputProps {
  /** Number of cells. */
  length: number;
  /** Current code (ASCII digits), e.g. `"123456"`. */
  value: string;
  /** Fired with the ASCII-digit code whenever it changes. */
  onChange: (value: string) => void;
  /** Fired when all `length` cells are filled. */
  onComplete?: (value: string) => void;
  /** Field name for `data-field-name` (focus targeting). */
  name?: string;
  /** Accessible label (defaults to translated `form.otp.label`). */
  label?: string;
  /** Pre-translated error announced to AT. */
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

/**
 * `OtpInput` (F1.4). An N-cell one-time-code entry used for verification.
 *
 * Behavior:
 *  - one visible `<input>` per cell, but a single hidden input carries
 *    `autocomplete="one-time-code"` so SMS-based autofill fills all cells;
 *  - typing a digit advances focus to the next cell;
 *  - backspace on an empty cell moves focus back and clears the previous cell;
 *  - pasting a full code fills as many cells as it can and focuses the cell
 *    after the last filled one;
 *  - Persian/Arabic digits are normalized to ASCII on input;
 *  - cells are always laid out left-to-right (`dir="ltr"`) so the digit // rtl-ok
 *    order matches the code regardless of page direction;
 *  - errors are announced via an `aria-live="polite"` region and each cell is
 *    `aria-invalid` when an error is present;
 *  - `onComplete` fires once all `length` cells are filled.
 */
export function OtpInput({
  length,
  value,
  onChange,
  onComplete,
  name,
  label,
  error,
  disabled = false,
  autoFocus = false,
  id,
}: OtpInputProps) {
  const t = useTranslations('form.otp');
  const fallbackId = useId();
  const groupId = id ?? fallbackId;
  const cellsRef = useRef<Array<HTMLInputElement | null>>([]);
  const completedRef = useRef(false);

  // Pad/truncate the value to `length` cells.
  const padded = (toAsciiDigits(value) + ' '.repeat(length)).slice(0, length);

  const setCode = useCallback(
    (next: string) => {
      const clean = toAsciiDigits(next).replace(/[^\d]/g, '').slice(0, length);
      onChange(clean);
      if (clean.length === length && !completedRef.current) {
        completedRef.current = true;
        onComplete?.(clean);
      }
      if (clean.length < length) {
        completedRef.current = false;
      }
    },
    [length, onChange, onComplete],
  );

  const focusCell = (idx: number) => {
    const clamped = Math.max(0, Math.min(length - 1, idx));
    cellsRef.current[clamped]?.focus();
    cellsRef.current[clamped]?.select();
  };

  const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = toAsciiDigits(e.target.value).replace(/[^\d]/g, '');
    if (raw.length === 0) return;
    // If the user typed more than one digit (or replaced the cell), take the
    // last typed digit for this cell and spill the rest into following cells.
    const chars = raw.split('');
    const next = padded.split('');
    let cursor = idx;
    for (const ch of chars) {
      if (cursor >= length) break;
      next[cursor] = ch;
      cursor += 1;
    }
    setCode(next.join('').trim());
    focusCell(cursor);
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = padded.split('');
      if (next[idx] !== ' ') {
        next[idx] = ' ';
        setCode(next.join('').trim());
      } else if (idx > 0) {
        next[idx - 1] = ' ';
        setCode(next.join('').trim());
        focusCell(idx - 1);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusCell(idx - 1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusCell(idx + 1);
      return;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = toAsciiDigits(e.clipboardData.getData('text')).replace(/[^\d]/g, '');
    if (text.length === 0) return;
    setCode(text);
    focusCell(Math.min(text.length, length - 1));
  };

  const labelText = label ?? t('label');

  return (
    <div
      role="group"
      aria-label={labelText}
      data-field-name={name}
      className="inline-flex flex-col gap-1"
    >
      {/* Hidden input carries the full value + autocomplete for SMS autofill. */}
      <input
        type="hidden"
        name={name}
        value={toAsciiDigits(value).replace(/[^\d]/g, '').slice(0, length)}
        autoComplete="one-time-code"
        aria-hidden="true"
        tabIndex={-1}
        readOnly
      />
      <div className="flex gap-2" dir="ltr">
        {Array.from({ length }).map((_, i) => (
          <input
            key={i}
            ref={(el) => {
              cellsRef.current[i] = el;
            }}
            id={`${groupId}-cell-${i}`}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={(padded[i] ?? ' ').trim()}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            aria-label={`${labelText} ${i + 1}`}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${groupId}-error` : undefined}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className={cn(
              'h-[calc(var(--control-h)*1.1)] w-[calc(var(--control-h)*1.1)] rounded-md border bg-surface text-center text-lg font-medium text-text',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error ? 'border-danger' : 'border-border',
            )}
          />
        ))}
      </div>
      {error ? (
        <p id={`${groupId}-error`} role="alert" aria-live="polite" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
