import { cn } from '../../lib/cn';

/**
 * `VisuallyHidden` (F1.3). Renders content that is invisible to sighted users
 * but read by screen readers (e.g. the accessible name of an icon-only
 * control). The `sr-only` Tailwind class + the `focus:not-sr-only` modifier
 * make it reappear on focus for keyboard users.
 */
export interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** When true the content is shown on focus (skip-link behavior). */
  showOnFocus?: boolean;
}

export function VisuallyHidden({ showOnFocus = false, className, ...rest }: VisuallyHiddenProps) {
  return (
    <span className={cn('sr-only', showOnFocus && 'focus:not-sr-only', className)} {...rest} />
  );
}
