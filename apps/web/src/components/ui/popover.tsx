'use client';

import { type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/cn';

export interface PopoverProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left'; // rtl-ok
  align?: 'start' | 'center' | 'end';
  className?: string;
  withArrow?: boolean;
}

/**
 * `Popover` (F1.5). Wraps Radix Popover. RTL: Radix mirrors `side`/`align`
 * for logical edges when the document `dir` is set. Focus is trapped while
 * open and returns to the trigger on close.
 */
export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  className,
  withArrow = true,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 w-72 rounded-md border border-border bg-surface p-4 text-text shadow-md',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            className,
          )}
        >
          {children}
          {withArrow ? (
            <PopoverPrimitive.Arrow className="fill-surface" width={12} height={6} />
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
