import { cn } from '../../lib/cn';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100. */
  value: number;
  /** Accessible label describing what the progress represents. */
  'aria-label': string;
}

/**
 * `ProgressBar` (F1.3). A determinate progress bar using the `primary` token
 * on a `surface-alt` track. `role="progressbar"` + `aria-valuenow/min/max`
 * make it announce correctly; the fill width follows `value`.
 */
export function ProgressBar({ value, className, ...rest }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-alt', className)}
      {...rest}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
