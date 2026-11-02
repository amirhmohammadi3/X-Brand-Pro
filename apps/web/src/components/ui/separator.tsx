import { cn } from '../../lib/cn';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** Decorative hairlines use borderSubtle (no ratio required). */
  decorative?: boolean;
}

/**
 * `Separator` (F1.3). A 1px hairline using `border-subtle` for decorative
 * dividers (DESIGN.md section 1). Set `decorative={false}` + `aria-label` for
 * a semantic separator that groups content.
 */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
  className,
  ...rest
}: SeparatorProps) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        'bg-border-subtle',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className,
      )}
      {...rest}
    />
  );
}
