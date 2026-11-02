import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';

export interface FormErrorEntry {
  /** Field name; matches the `name` passed to `<Field name=... />`. */
  name: string;
  /** Human-readable field label for the link text. */
  label: string;
  /** Pre-translated error message. */
  message: ReactNode;
}

export interface FormErrorProps {
  errors: ReadonlyArray<FormErrorEntry>;
  /** Override the heading text. */
  title?: string;
  className?: string;
}

/**
 * `FormError` (F1.4). A form-level error summary that lists every invalid
 * field as a link. Clicking a link moves focus to the field (the field's
 * `id` is `<name>-<useId>`, but the inputs also carry `data-field-name`, so
 * the link targets that attribute instead of guessing the generated id).
 *
 * The summary has `role="alert"` so it is announced on mount, and lives in a
 * landmark-friendly `<section>` with a heading.
 */
export function FormError({ errors, title, className }: FormErrorProps) {
  const t = useTranslations('form.errorSummary');
  const headingId = useId();
  if (errors.length === 0) return null;

  const handleClick = (name: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const el = document.querySelector<HTMLElement>(`[data-field-name="${CSS.escape(name)}"]`);
    el?.focus();
  };

  return (
    <section
      role="alert"
      aria-labelledby={headingId}
      className={cn('rounded-md border border-danger bg-danger/10 p-3', className)}
    >
      <h2 id={headingId} className="text-sm font-medium text-danger mb-1.5">
        {title ?? t('title')}
      </h2>
      <ul className="flex flex-col gap-1">
        {errors.map((err) => (
          <li key={err.name} className="text-sm">
            <a
              href={`#field-${err.name}`}
              onClick={handleClick(err.name)}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {t('link', { label: err.label })}
            </a>
            <span className="text-text ms-1">— {err.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
