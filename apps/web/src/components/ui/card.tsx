import { cn } from '../../lib/cn';

/**
 * `Card` family (F1.3). The card LOOK comes from the active pack's
 * `data-card` attribute (outlined / elevated / bordered — DESIGN.md section
 * 8); the rules live in `src/styles/components.css` and read the runtime
 * `--tok-*` / `--shadow-*` variables, so the same component renders three
 * different looks per pack with zero per-component CSS. The attribute is read
 * from `<html data-card>` (set by the layout) unless overridden per card.
 *
 * Use the sub-components for consistent padding: `CardHeader`, `CardBody`,
 * `CardFooter`.
 */

export type CardStyle = 'outlined' | 'elevated' | 'bordered';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Override the active pack's card style for this card only. */
  cardStyle?: CardStyle;
}

export function Card({ cardStyle, className, ...rest }: CardProps) {
  return (
    <div
      data-card={cardStyle ?? ''}
      className={cn('rounded-lg overflow-hidden', className)}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-[var(--card-p)] py-3 border-b border-border-subtle', className)}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-[var(--card-p)]', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-[var(--card-p)] py-3 border-t border-border-subtle', className)}
      {...rest}
    />
  );
}
