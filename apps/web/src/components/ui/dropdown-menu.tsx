'use client';

import { type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left'; // rtl-ok
  className?: string;
}

/**
 * `DropdownMenu` (F1.5). Wraps Radix DropdownMenu. Arrow-key navigation is
 * provided by Radix and is RTL-aware: in an RTL document, ArrowRight moves
 * to the previous item and ArrowLeft to the next (mirroring the visual
 * reading order).
 */
export function DropdownMenuRoot({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className,
}: DropdownMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 min-w-[12rem] rounded-md border border-border bg-surface p-1 text-text shadow-md',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            className,
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface DropdownItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: (e: Event) => void;
}

export function DropdownItem({
  destructive = false,
  disabled,
  onSelect,
  className,
  children,
  ...rest
}: DropdownItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none',
        'focus:bg-surface-alt focus:text-text',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive ? 'text-danger focus:bg-danger/10' : 'text-text',
        className,
      )}
      {...rest}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function DropdownSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />;
}

export interface DropdownCheckboxItemProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function DropdownCheckboxItem({
  checked,
  onCheckedChange,
  disabled,
  children,
}: DropdownCheckboxItemProps) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none',
        'focus:bg-surface-alt',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check size={14} className="text-primary" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export function DropdownSub({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className={cn(
          'flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm outline-none',
          'focus:bg-surface-alt',
        )}
      >
        {trigger}
        <ChevronRight size={14} className="rtl:-scale-x-100" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={4}
          className={cn(
            'z-50 min-w-[10rem] rounded-md border border-border bg-surface p-1 text-text shadow-md',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-text-subtle">
      {children}
    </DropdownMenu.Label>
  );
}

export { DropdownMenuRoot as DropdownMenu };
