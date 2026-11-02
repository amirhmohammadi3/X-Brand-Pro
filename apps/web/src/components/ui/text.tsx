import { cn } from '../../lib/cn';

export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  muted?: boolean;
  /** Render as a block-level paragraph instead of inline. */
  as?: 'span' | 'p';
}

const SIZE_CLASS = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
} as const;

/**
 * `Text` (F1.3). Body text with the size scale and an optional `muted`
 * variant (the `muted` token). Defaults to inline `span`; pass `as="p"` for a
 * paragraph.
 */
export function Text({ size = 'md', muted = false, as = 'span', className, ...rest }: TextProps) {
  const Tag = as;
  return <Tag className={cn(SIZE_CLASS[size], muted && 'text-muted', className)} {...rest} />;
}
