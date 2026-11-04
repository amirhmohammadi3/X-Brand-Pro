import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * `Container` (F1.7). Centers content with the app's max width and
 * responsive horizontal padding. Used by every page section.
 */
export interface ContainerProps {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

export function Container({ as: Tag = 'div', className, children }: ContainerProps) {
  return (
    <Tag className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)}>{children}</Tag>
  );
}

/**
 * `Section` (F1.7). A vertical page section with consistent spacing.
 */
export interface SectionProps {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

export function Section({ as: Tag = 'section', className, children }: SectionProps) {
  return <Tag className={cn('py-8 sm:py-12', className)}>{children}</Tag>;
}
