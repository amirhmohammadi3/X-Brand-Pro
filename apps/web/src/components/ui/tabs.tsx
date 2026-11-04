'use client';

import { type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn';

export interface TabsProps {
  tabs: ReadonlyArray<{ value: string; label: ReactNode; content?: ReactNode }>;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  listClassName?: string;
}

/**
 * `Tabs` (F1.5). Wraps Radix Tabs. Arrow-key navigation is RTL-aware: in an
 * RTL document ArrowLeft/Right are swapped by Radix so they follow the visual
 * reading order. `aria-selected` is set on the active trigger; panels are
 * lazy by default (only the selected panel mounts).
 */
export function Tabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  className,
  listClassName,
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue ?? tabs[0]?.value}
      onValueChange={onValueChange}
      orientation={orientation}
      className={cn('flex flex-col gap-3', orientation === 'vertical' && 'sm:flex-row', className)}
    >
      <TabsPrimitive.List
        className={cn(
          'flex shrink-0 gap-1',
          orientation === 'horizontal'
            ? 'flex-row border-b border-border-subtle'
            : 'sm:flex-col sm:border-e sm:border-b-0',
          listClassName,
        )}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              'inline-flex items-center justify-center whitespace-nowrap px-3 py-2 text-sm font-medium',
              'text-text-subtle transition-colors',
              'hover:text-text',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              'data-[state=active]:text-text',
              orientation === 'horizontal'
                ? 'border-b-2 border-transparent -mb-px data-[state=active]:border-primary'
                : 'border-s-2 border-transparent data-[state=active]:border-primary',
            )}
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content
          key={tab.value}
          value={tab.value}
          className="flex-1 focus-visible:outline-none"
        >
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
