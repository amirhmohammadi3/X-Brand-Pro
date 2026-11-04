'use client';

import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  dismissible?: boolean;
  trigger?: ReactNode;
  className?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

/**
 * `Modal` (F1.5). Wraps Radix Dialog so we get focus trap, ESC handling,
 * `aria-modal`, focus return to the trigger and scroll-lock for free.
 *
 * RTL: Radix respects the document `dir`; the close button uses logical
 * positioning (`top-2 end-2`) so it mirrors.
 *
 * Responsive: under 768px the dialog switches to a bottom sheet — slides up
 * from the bottom, full width, rounded top corners, a drag handle and
 * `env(safe-area-inset-bottom)` padding.
 *
 * `dismissible={false}` disables both ESC and overlay-click close for
 * destructive flows that must use the explicit action button.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  trigger,
  className,
}: ModalProps) {
  const t = useTranslations('form.overlay');
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
            'fixed z-50 flex flex-col bg-surface text-text shadow-lg',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2', // rtl-ok
            'w-[calc(100%-2rem)] rounded-lg',
            SIZE_CLASS[size],
            'max-h-[85vh]',
            'max-md:left-0 max-md:right-0 max-md:top-auto max-md:bottom-0', // rtl-ok
            'max-md:translate-x-0 max-md:translate-y-0',
            'max-md:w-full max-md:max-h-[90vh] max-md:rounded-b-none',
            'max-md:rounded-t-xl max-md:pb-[env(safe-area-inset-bottom)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:slide-out-to-bottom',
            className,
          )}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border max-md:block hidden"
          />
          <div className="flex items-start justify-between gap-3 p-4 pb-2">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-base font-semibold text-text">{title}</Dialog.Title>
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
          <div className="flex-1 overflow-y-auto px-4 py-2">{children}</div>
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

export function useModalState(initial = false) {
  const [open, setOpen] = useState(initial);
  return {
    open,
    setOpen,
    isOpen: open,
    openModal: () => setOpen(true),
    closeModal: () => setOpen(false),
  };
}
