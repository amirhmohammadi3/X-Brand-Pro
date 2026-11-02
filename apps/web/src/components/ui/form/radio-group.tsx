import { useId, type ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: ReadonlyArray<RadioOption>;
  /** Visible group label. */
  label: ReactNode;
  /** Pre-translated error announced to AT. */
  error?: string;
  /** Stack vertically (default) or inline. */
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  id?: string;
}

/**
 * `RadioGroup` (F1.4). Native radios grouped under a fieldset/legend so the
 * group semantics and label are free. Each option's label is real text tied
 * to its radio via `htmlFor`. Errors are announced via a live region.
 */
export function RadioGroup({
  name,
  value,
  defaultValue,
  onChange,
  options,
  label,
  error,
  orientation = 'vertical',
  disabled = false,
  id,
}: RadioGroupProps) {
  const fallbackId = useId();
  const groupId = id ?? fallbackId;
  const errorId = `${groupId}-error`;
  return (
    <fieldset
      className={cn(
        'flex flex-col gap-1.5',
        orientation === 'horizontal' && 'sm:flex-row sm:flex-wrap sm:gap-4',
      )}
    >
      <legend className="text-sm font-medium text-text mb-0.5">{label}</legend>
      <div
        role="radiogroup"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
      >
        {options.map((opt, i) => {
          const radioId = `${groupId}-${i}`;
          const descId = opt.description ? `${radioId}-desc` : undefined;
          const checked = value !== undefined ? value === opt.value : undefined;
          return (
            <span key={opt.value} className="inline-flex items-start gap-2">
              <input
                id={radioId}
                type="radio"
                name={name}
                value={opt.value}
                checked={checked}
                defaultChecked={defaultValue === undefined ? undefined : defaultValue === opt.value}
                disabled={disabled || opt.disabled}
                onChange={(e) => e.target.checked && onChange?.(opt.value)}
                aria-describedby={descId}
                className={cn(
                  'mt-0.5 h-4 w-4 border border-border bg-surface appearance-none rounded-full',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  'checked:border-primary checked:bg-surface',
                  'checked:ring-4 checked:ring-primary checked:ring-inset',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              />
              <span className="flex flex-col">
                <label htmlFor={radioId} className="text-sm text-text cursor-pointer">
                  {opt.label}
                </label>
                {opt.description ? (
                  <span id={descId} className="text-xs text-text-subtle">
                    {opt.description}
                  </span>
                ) : null}
              </span>
            </span>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" aria-live="polite" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
