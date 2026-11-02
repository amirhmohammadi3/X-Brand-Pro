import { cn } from '../../lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: 'text' | 'circle' | 'rect';
  /** For `text` shape, the number of lines. */
  lines?: number;
}

/**
 * `Skeleton` (F1.3). A non-interactive placeholder that signals "content is
 * loading". Three shapes:
 *  - `text`: one or more lines of surface-alt bars with the shimmer class;
 *  - `circle`: a round avatar/Icon placeholder;
 *  - `rect`: a generic block.
 * The shimmer animation honors `prefers-reduced-motion` (components.css).
 */
export function Skeleton({ shape = 'rect', lines = 1, className, ...rest }: SkeletonProps) {
  if (shape === 'text') {
    return (
      <div className={cn('flex flex-col gap-2', className)} {...rest}>
        {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer h-3 rounded-sm"
            style={{ width: i === lines - 1 ? '60%' : '100%' }}
            aria-hidden
          />
        ))}
      </div>
    );
  }
  if (shape === 'circle') {
    return (
      <div
        className={cn('skeleton-shimmer rounded-full h-10 w-10', className)}
        aria-hidden
        {...rest}
      />
    );
  }
  return (
    <div
      className={cn('skeleton-shimmer rounded-md h-24 w-full', className)}
      aria-hidden
      {...rest}
    />
  );
}
