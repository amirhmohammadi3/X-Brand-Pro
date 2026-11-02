'use client';

import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const tagStyles = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border transition-colors',
  {
    variants: {
      selected: {
        true: 'bg-primary text-on-primary border-primary',
        false: 'bg-surface-alt text-text border-border-subtle hover:border-border',
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface TagProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagStyles> {
  selectable?: boolean;
  selected?: boolean;
  removable?: boolean;
  /** Called when the remove button is clicked. */
  onRemove?: () => void;
  /** Accessible label for the remove button (required when removable). */
  removeLabel?: string;
}

/**
 * `Tag` / `Chip` (F1.3). A compact label that can be `selectable` (renders as
 * a toggle button), `removable` (renders a small close button with a required
 * `removeLabel`) or plain. Color is never the only signal: the selected state
 * uses `primary` background + `on-primary` text and the `aria-pressed`
 * attribute; the unselected state uses `surface-alt`.
 */
export function Tag({
  selectable,
  selected = false,
  removable,
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: TagProps) {
  if (selectable) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={cn(tagStyles({ selected }), 'cursor-pointer', className)}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={cn(tagStyles({ selected }), className)} {...rest}>
      {children}
      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? 'remove'}
          className="ms-0.5 inline-flex items-center rounded-sm p-0.5 hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
