import { cn } from '../../lib/cn';

export type KbdProps = React.HTMLAttributes<HTMLElement>;

/**
 * `Kbd` (F1.3). Inline keyboard key indicator, e.g. for shortcut hints. Uses
 * the `surface-alt`/`border-subtle` tokens and a small radius so it reads as
 * a physical key without resembling a button.
 */
export function Kbd({ className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-sm border border-border-subtle bg-surface-alt text-xs font-mono text-text',
        className,
      )}
      {...rest}
    />
  );
}
