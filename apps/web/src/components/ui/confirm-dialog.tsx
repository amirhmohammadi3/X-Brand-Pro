'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from './modal';
import { Button } from './button';

export interface ConfirmOptions {
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  destructive?: boolean;
  onConfirm?: () => Promise<void> | void;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * `useConfirm` (F1.5) — a promise-based confirm hook. Call `confirm(opts)` to
 * open a `ConfirmDialog`; it resolves `true` when the user confirms (after
 * `onConfirm` resolves, if provided) or `false` when cancelled.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [loading, setLoading] = useState(false);
  const queue = useRef<PendingConfirm[]>([]);

  const resolveCurrent = useCallback((value: boolean) => {
    setPending((cur) => {
      cur?.resolve(value);
      return null;
    });
    setLoading(false);
    const next = queue.current.shift();
    if (next) setPending(next);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const item: PendingConfirm = { ...opts, resolve };
      setPending((cur) => {
        if (cur) {
          queue.current.push(item);
          return cur;
        }
        return item;
      });
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (pending?.onConfirm) {
      setLoading(true);
      try {
        await pending.onConfirm();
      } catch {
        setLoading(false);
        resolveCurrent(false);
        return;
      }
    }
    resolveCurrent(true);
  }, [pending, resolveCurrent]);

  const t = useTranslations('form.overlay');
  const tConfirm = useTranslations('form.confirm');

  const dialog = (
    <Modal
      open={pending !== null}
      onOpenChange={(o) => {
        if (!o) resolveCurrent(false);
      }}
      title={pending?.title ?? tConfirm('title')}
      description={pending?.description ?? tConfirm('description')}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolveCurrent(false)} disabled={loading}>
            {pending?.cancelLabel ?? t('cancel')}
          </Button>
          <Button
            variant={pending?.destructive ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={loading}
          >
            {pending?.confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );

  return { confirm, dialog };
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * `ConfirmDialog` (F1.5). A controlled confirm modal for callers that prefer a
 * declarative `open` prop over the promise hook.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations('form.overlay');
  const tConfirm = useTranslations('form.confirm');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (onConfirm) {
      setLoading(true);
      try {
        await onConfirm();
      } catch {
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!loading) onOpenChange(o);
      }}
      title={title ?? tConfirm('title')}
      description={description ?? tConfirm('description')}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={loading}
          >
            {confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
