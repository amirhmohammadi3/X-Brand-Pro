import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeStyles = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-alt text-text border-border-subtle',
        primary: 'bg-surface-alt text-primary border-border-subtle',
        success: 'bg-surface-alt text-success border-border-subtle',
        warning: 'bg-surface-alt text-warning border-border-subtle',
        danger: 'bg-surface-alt text-danger border-border-subtle',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeStyles>['variant']>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Optional leading icon (status badge = surfaceAlt bg + colored text + icon, never color alone). */
  leadingIcon?: LucideIcon;
}

/**
 * `Badge` (F1.3). Status labels with the `surfaceAlt` background + status
 * color + optional icon (DESIGN.md section 1: "A status badge is surfaceAlt
 * background + status-colored text + icon (never color alone)"). Color is
 * NEVER the only signal: the variant sets the text/icon color on a neutral
 * background, and an icon reinforces it.
 */
export function Badge({ variant, leadingIcon: Icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badgeStyles({ variant }), className)} {...rest}>
      {Icon ? <Icon aria-hidden className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}
