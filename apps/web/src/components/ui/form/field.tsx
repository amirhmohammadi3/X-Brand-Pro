import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Show the platform's required marker «(الزامی)» after the text. */
  required?: boolean;
  /** Visually hide the label but keep it for screen readers. */
  visuallyHidden?: boolean;
}

/**
 * `Label` (F1.4). A plain `<label>` with the platform's required marker.
 * The marker text comes from `form.required` so it is localized, and it is
 * rendered as visible text (not just an asterisk) so screen-reader and
 * sighted users get the same signal.
 */
export function Label({
  required = false,
  visuallyHidden = false,
  className,
  children,
  htmlFor,
  ...rest
}: LabelProps) {
  const t = useTranslations('form');
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'block text-sm font-medium text-text mb-1',
        visuallyHidden && 'sr-only',
        className,
      )}
      {...rest}
    >
      {children}
      {required ? (
        <span className="ms-1 text-danger" aria-hidden="true">
          *
        </span>
      ) : null}
      {required ? <span className="ms-1 text-xs text-text-subtle">{t('required')}</span> : null}
    </label>
  );
}

export interface FieldProps {
  /** Form field name — also written to `data-field-name` for focus targeting. */
  name: string;
  label?: ReactNode;
  /** Helper text shown under the input when there is no error. */
  hint?: ReactNode;
  /** Error message (already translated) shown under the input, announced live. */
  error?: ReactNode;
  required?: boolean;
  /** The control. `Field` wires `aria-describedby` and `aria-invalid`. */
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': 'true' | undefined;
    'data-field-name': string;
  }) => ReactNode;
  className?: string;
}

/**
 * `Field` (F1.4) — the wrapper that gives every form control its label,
 * hint, error, and accessible wiring.
 *
 * Accessibility contract:
 *  - the label's `htmlFor` points at the control's `id`;
 *  - `aria-describedby` links the control to its hint and/or error;
 *  - `aria-invalid="true"` is set when an error is present;
 *  - the error is announced through a `aria-live="polite"` region;
 *  - the control is tagged with `data-field-name` so `useZodForm
 *    .setServerErrors` can focus the first invalid field.
 */
export function Field({
  name,
  label,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldProps) {
  const autoId = useId();
  const id = `${name}-${autoId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col', className)} data-field={name}>
      {label !== undefined ? (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      ) : null}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? 'true' : undefined,
        'data-field-name': name,
      })}
      {hint && !error ? (
        <p id={hintId} className="mt-1 text-xs text-text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" aria-live="polite" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
