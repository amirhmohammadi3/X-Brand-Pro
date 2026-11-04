'use client';

import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';

export type DrawerSide = 'start' | 'end';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: DrawerSide;
  widthClass?: string;
  dismissible?: boolean;
  trigger?: ReactNode;
  className?: string;
}

/**
 * `Drawer` (F1.5). A side panel that slides in from the logical `end` edge by
 * default — right in LTR, left in RTL — so it always opens from the side the
 * reading flow ends on. Use `side="start"` for the opposite edge.
 *
 * Built on Radix Dialog, so it inherits focus trap, ESC, scroll-lock and focus
 * return. The slide animation direction is logical so it mirrors with `dir`.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'end',
  widthClass = 'max-w-md',
  dismissible = true,
  trigger,
  className,
}: DrawerProps) {
  const t = useTranslations('form.overlay');
  const isEnd = side === 'end';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          className={cn(
            'fixed z-50 flex h-full flex-col bg-surface text-text shadow-xl',
            isEnd ? 'inset-inline-end-0 ms-auto' : 'inset-inline-start-0 me-auto',
            'w-full max-md:w-full',
            widthClass,
            'max-h-full',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            isEnd
              ? 'data-[state=open]:slide-in-from-end data-[state=closed]:slide-out-to-end'
              : 'data-[state=open]:slide-in-from-start data-[state=closed]:slide-out-to-start',
            className,
          )}
        >
          {(title || dismissible) && (
            <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-4">
              <div className="flex flex-col gap-1">
                {title ? (
                  <Dialog.Title className="text-base font-semibold text-text">{title}</Dialog.Title>
                ) : (
                  <Dialog.Title className="sr-only">{t('close')}</Dialog.Title>
                )}
                {description ? (
                  <Dialog.Description className="text-sm text-text-subtle">
                    {description}
                  </Dialog.Description>
                ) : null}
              </div>
              {dismissible ? (
                <Dialog.Close asChild>
                  <IconButton
                    icon={X}
                    aria-label={t('close')}
                    className="-mt-1 -me-1 text-text-subtle hover:text-text"
                  />
                </Dialog.Close>
              ) : null}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle p-4">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
