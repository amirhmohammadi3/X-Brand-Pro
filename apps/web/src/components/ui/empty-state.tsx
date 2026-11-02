import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Heading } from './heading';
import { Text } from './text';
import { Button, type ButtonProps } from './button';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional primary action rendered as a Button. */
  action?: {
    label: string;
    onClick: ButtonProps['onClick'];
    variant?: ButtonProps['variant'];
  };
}

/**
 * `EmptyState` (F1.3). The "no results / nothing here yet" surface: an icon,
 * a title, an optional description and an optional primary action. All text is
 * passed as props (i18n at the call site), so the component itself is pure.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-12 text-center', className)} {...rest}>
      <Icon aria-hidden className="h-10 w-10 text-muted" />
      <Heading level="h3">{title}</Heading>
      {description ? (
        <Text muted className="max-w-md">
          {description}
        </Text>
      ) : null}
      {action ? (
        <Button variant={action.variant ?? 'primary'} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
