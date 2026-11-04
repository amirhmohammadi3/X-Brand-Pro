'use client';

import { type ReactNode } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface AccordionItem {
  value: string;
  header: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface AccordionProps {
  items: ReadonlyArray<AccordionItem>;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  multiple?: boolean;
  className?: string;
}

/**
 * `Accordion` (F1.5). Wraps Radix Accordion. The chevron rotates on open.
 * Arrow-key navigation between headers and Home/End are provided by Radix.
 */
export function Accordion({
  items,
  value,
  defaultValue,
  onValueChange,
  multiple = true,
  className,
}: AccordionProps) {
  const Comp = AccordionPrimitive.Root;
  return (
    <Comp
      type={multiple ? 'multiple' : 'multiple'}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange as (v: string | string[]) => void}
      className={cn('flex flex-col gap-1', className)}
    >
      {items.map((item) => (
        <AccordionPrimitive.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          className="overflow-hidden rounded-md border border-border-subtle"
        >
          <AccordionPrimitive.Header>
            <AccordionPrimitive.Trigger
              className={cn(
                'flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-text',
                'hover:bg-surface-alt',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
                'group',
              )}
            >
              {item.header}
              <ChevronDown
                size={16}
                className="shrink-0 text-text-subtle transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="overflow-hidden text-sm text-text-subtle data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
            <div className="px-4 py-3">{item.content}</div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </Comp>
  );
}
