'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';

export type BottomSheetSnap = 'collapsed' | 'half' | 'full';

const SNAP_HEIGHT: Record<BottomSheetSnap, string> = {
  collapsed: '20vh',
  half: '50vh',
  full: '90vh',
};

const SNAP_ORDER: BottomSheetSnap[] = ['collapsed', 'half', 'full'];

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  children?: ReactNode;
  defaultSnap?: BottomSheetSnap;
  snap?: BottomSheetSnap;
  onSnapChange?: (snap: BottomSheetSnap) => void;
  dismissible?: boolean;
  trigger?: ReactNode;
  className?: string;
  /** Radix modal mode (default true). `false` keeps the page interactive
   * behind the sheet — the map-search page's sheet is a persistent PANEL,
   * not a blocking dialog (F3.4). */
  modal?: boolean;
}

/**
 * `BottomSheet` (F1.5). A mobile-first sheet with three snap points —
 * collapsed, half, full — used by the map screens (F3.4).
 *
 * Pointer: the handle is draggable; dragging up moves toward `full`, dragging
 * down toward `collapsed` (and past it closes). Keyboard: two buttons cycle
 * snap points, so the sheet is fully usable without a pointer. ESC closes
 * unless `dismissible=false`.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  defaultSnap = 'half',
  snap: controlledSnap,
  onSnapChange,
  dismissible = true,
  trigger,
  className,
  modal = true,
}: BottomSheetProps) {
  const t = useTranslations('form.overlay');
  const [internalSnap, setInternalSnap] = useState<BottomSheetSnap>(defaultSnap);
  const snap = controlledSnap ?? internalSnap;
  const dragStartY = useRef<number | null>(null);
  const dragStartSnap = useRef<BottomSheetSnap>(snap);

  const setSnap = useCallback(
    (next: BottomSheetSnap) => {
      if (controlledSnap === undefined) setInternalSnap(next);
      onSnapChange?.(next);
    },
    [controlledSnap, onSnapChange],
  );

  const cycleSnap = useCallback(
    (dir: 1 | -1) => {
      const idx = SNAP_ORDER.indexOf(snap);
      const next = SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, Math.max(0, idx + dir))];
      if (next && next !== snap) setSnap(next);
    },
    [snap, setSnap],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragStartSnap.current = snap;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (_e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    dragStartY.current = null;
    const startIdx = SNAP_ORDER.indexOf(dragStartSnap.current);
    if (delta < -40) {
      const next = SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, startIdx + 1)];
      if (next) setSnap(next);
    } else if (delta > 40) {
      const next = SNAP_ORDER[Math.max(0, startIdx - 1)];
      if (
        next === 'collapsed' &&
        delta > 120 &&
        dragStartSnap.current === 'collapsed' &&
        dismissible
      ) {
        onOpenChange(false);
      } else if (next) {
        setSnap(next);
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        cycleSnap(1);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        cycleSnap(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, cycleSnap]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
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
          style={{ height: SNAP_HEIGHT[snap] }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl bg-surface text-text shadow-xl',
            'pb-[env(safe-area-inset-bottom)]',
            'transition-[height] duration-300 ease-out',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
            className,
          )}
        >
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('dragHandle')}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="flex cursor-grab touch-none justify-center py-2 active:cursor-grabbing"
          >
            <span className="h-1.5 w-10 rounded-full bg-border" />
          </div>
          <div className="flex items-center justify-between gap-2 px-4 pb-2">
            <div className="flex items-center gap-1">
              <IconButton
                icon={ChevronUp}
                aria-label={t('dragHandle')}
                onClick={() => cycleSnap(1)}
                disabled={snap === 'full'}
                className="text-text-subtle"
              />
              <IconButton
                icon={ChevronDown}
                aria-label={t('dragHandle')}
                onClick={() => cycleSnap(-1)}
                disabled={snap === 'collapsed'}
                className="text-text-subtle"
              />
              {title ? (
                <Dialog.Title className="ms-1 text-sm font-semibold text-text">
                  {title}
                </Dialog.Title>
              ) : (
                <Dialog.Title className="sr-only">{t('dragHandle')}</Dialog.Title>
              )}
            </div>
            {dismissible ? (
              <Dialog.Close asChild>
                <IconButton
                  icon={X}
                  aria-label={t('close')}
                  className="text-text-subtle hover:text-text"
                />
              </Dialog.Close>
            ) : null}
          </div>
          <Dialog.Description className="sr-only">{t('dragHandle')}</Dialog.Description>
          <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
