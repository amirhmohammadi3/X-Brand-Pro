import { useId, type ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface SwitchProps {
  checked: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
  /** Visible text label next to the switch. */
  label: ReactNode;
  description?: ReactNode;
  id?: string;
}

/**
 * `Switch` (F1.4). A toggle with `role="switch"`. Built on a native checkbox
 * (so it works in forms and submits its value) but visually styled as a
 * sliding track + thumb. The label is real text bound via `htmlFor`, and the
 * control exposes `aria-checked` through the implicit switch role mapping.
 */
export function Switch({
  checked,
  defaultChecked,
  onChange,
  name,
  disabled = false,
  label,
  description,
  id,
}: SwitchProps) {
  const fallbackId = useId();
  const switchId = id ?? fallbackId;
  const descId = description ? `${switchId}-desc` : undefined;
  const controlled = checked !== undefined;
  return (
    <span className="inline-flex items-start gap-2.5">
      <span className="relative inline-flex items-center">
        {/* Hidden native input keeps form participation + defaultChecked. It
            lives outside the switch button so the button has no focusable
            content (axe: no-focusable-content / nested-interactive). */}
        <input
          type="checkbox"
          name={name}
          checked={controlled ? checked : undefined}
          defaultChecked={defaultChecked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          role="presentation"
        />
        <button
          type="button"
          role="switch"
          id={switchId}
          aria-checked={controlled ? checked : undefined}
          aria-describedby={descId}
          disabled={disabled}
          onClick={() => !disabled && onChange?.(!checked)}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'aria-[invalid=true]:border-danger',
          )}
          data-checked={controlled ? checked : undefined}
          style={{
            backgroundColor: controlled
              ? checked
                ? 'var(--color-primary)'
                : 'var(--color-surface-alt)'
              : undefined,
          }}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 rounded-full bg-surface shadow transition-transform',
              'translate-x-0.5',
            )}
            style={{
              transform: controlled && checked ? 'translateX(calc(var(--spacing)*5))' : undefined,
              backgroundColor: 'var(--color-surface)',
            }}
          />
        </button>
      </span>
      <span className="flex flex-col">
        <label htmlFor={switchId} className="text-sm text-text cursor-pointer">
          {label}
        </label>
        {description ? (
          <span id={descId} className="text-xs text-text-subtle">
            {description}
          </span>
        ) : null}
      </span>
    </span>
  );
}
