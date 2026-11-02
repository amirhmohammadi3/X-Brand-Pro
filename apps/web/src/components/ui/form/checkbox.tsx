import { forwardRef, useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../lib/cn';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** Optional helper text under the label. */
  description?: ReactNode;
}

/**
 * `Checkbox` (F1.4). A native checkbox visually replaced by a styled box so
 * it keeps native keyboard/focus behavior and form participation. The label
 * is real text next to the control (not wrapped) so clicking it toggles the
 * box without extra `htmlFor` wiring.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id, ...rest },
  ref,
) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const descId = description ? `${inputId}-desc` : undefined;
  return (
    <span className="inline-flex items-start gap-2">
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          aria-describedby={descId}
          className={cn(
            'peer h-5 w-5 rounded border border-border bg-surface appearance-none',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'checked:border-primary checked:bg-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'aria-[invalid=true]:border-danger',
            className,
          )}
          {...rest}
        />
        <Check
          size={14}
          className="pointer-events-none absolute text-on-primary opacity-0 peer-checked:opacity-100"
          aria-hidden="true"
        />
      </span>
      <span className="flex flex-col">
        <label htmlFor={inputId} className="text-sm text-text cursor-pointer">
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
});
