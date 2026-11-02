import { cn } from '../../lib/cn';

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
}

/**
 * `Heading` (F1.3). Renders an `h1`–`h6` whose weight and Latin letter-spacing
 * come from the active pack's tokens (`--heading-weight`, `--latin-heading-ls`,
 * set on `h1..h6` in globals.css base layer). The size scale is fixed per
 * level so headings stay consistent across packs; only weight/spacing change.
 */
const SIZE_CLASS: Record<HeadingLevel, string> = {
  h1: 'text-4xl',
  h2: 'text-3xl',
  h3: 'text-2xl',
  h4: 'text-xl',
  h5: 'text-lg',
  h6: 'text-base',
};

export function Heading({ level = 'h2', className, ...rest }: HeadingProps) {
  const Tag = level;
  return <Tag className={cn('font-bold', SIZE_CLASS[level], className)} {...rest} />;
}
