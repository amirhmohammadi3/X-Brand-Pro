import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const spinnerStyles = cva('animate-spin', {
  variants: {
    size: {
      sm: 'h-3.5 w-3.5',
      md: 'h-4 w-4',
      lg: 'h-5 w-5',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface SpinnerProps
  extends React.SVGProps<SVGSVGElement>,
    VariantProps<typeof spinnerStyles> {
  /** Accessible label; when set the spinner gets `role="status"` + sr-only text. */
  label?: string;
}

/**
 * `Spinner` — the loading indicator used inside `Button` (loading) and any
 * async surface (F1.3). Decorative by default (`aria-hidden`); pass `label`
 * to announce "loading" to screen readers.
 */
export function Spinner({ size, label, className, ...rest }: SpinnerProps) {
  if (label) {
    return (
      <span role="status" className="inline-flex items-center gap-2">
        <Loader2 aria-hidden className={cn(spinnerStyles({ size }), className)} {...rest} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return <Loader2 aria-hidden className={cn(spinnerStyles({ size }), className)} {...rest} />;
}
