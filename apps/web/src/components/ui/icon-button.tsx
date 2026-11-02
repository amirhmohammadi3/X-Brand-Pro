import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { Spinner } from './spinner';

const iconButtonStyles = cva(
  'inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aspect-square',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:opacity-90',
        secondary: 'bg-surface-alt text-text border border-border-subtle hover:opacity-90',
        ghost: 'bg-transparent text-text hover:bg-surface-alt',
        danger: 'bg-danger text-on-primary hover:opacity-90',
      },
      size: {
        sm: 'h-8 w-8',
        md: 'h-[var(--control-h)] w-[var(--control-h)]',
        lg: 'h-12 w-12',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonStyles> {
  icon: LucideIcon;
  /** Required — an icon-only button is meaningless without a name. */
  'aria-label': string;
  loading?: boolean;
}

/**
 * `IconButton` (F1.3). Square button holding a single icon; `aria-label` is
 * mandatory (the TS type makes it required). Loading swaps the icon for a
 * spinner and blocks clicks.
 */
export function IconButton({
  icon: Icon,
  variant,
  size,
  loading = false,
  className,
  disabled,
  onClick,
  ...rest
}: IconButtonProps) {
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      type="button"
      className={cn(iconButtonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : <Icon aria-hidden />}
    </button>
  );
}
