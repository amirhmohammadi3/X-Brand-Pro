import { forwardRef, useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: ReadonlyArray<SelectOption>;
  /** Optional placeholder shown as a disabled first option. */
  placeholder?: string;
  /** Optional group label rendered above the options (visually hidden). */
  label?: ReactNode;
}

/**
 * `Select` (F1.4). A native `<select>` styled to match the platform, chosen
 * deliberately over a custom dropdown: native selects give the best mobile
 * experience (the OS picker) and free keyboard/accessibility support. A
 * chevron icon is layered on top with logical (LTR-aware) positioning.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, id, label, ...rest },
  ref,
) {
  const fallbackId = useId();
  const selectId = id ?? fallbackId;
  return (
    <span className="relative inline-flex items-center w-full">
      <select
        ref={ref}
        id={selectId}
        aria-label={typeof label === 'string' ? label : undefined}
        className={cn(
          'w-full appearance-none rounded-md border border-border bg-surface px-3 pe-9 text-sm text-text',
          'h-[var(--control-h)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'aria-[invalid=true]:border-danger',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute inset-inline-end-3 text-text-subtle"
        aria-hidden="true"
      />
    </span>
  );
});
