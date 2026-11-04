'use client';

import { type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/cn';

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left'; // rtl-ok
  align?: 'start' | 'center' | 'end';
  delayMs?: number;
}

/**
 * `Tooltip` (F1.5). Wraps Radix Tooltip. Radix shows the tooltip on hover AND
 * on keyboard focus, so keyboard users get the same hint — never rely on a
 * tooltip alone for essential info. The provider is bundled inside so callers
 * don't need to wrap their tree.
 */
export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  delayMs = 300,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayMs} skipDelayDuration={500}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            className={cn(
              'z-50 max-w-xs rounded-md bg-text px-2.5 py-1.5 text-xs text-surface shadow-md',
              'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-text" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
