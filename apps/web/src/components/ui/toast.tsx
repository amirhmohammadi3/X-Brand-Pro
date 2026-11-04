'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  description?: ReactNode;
  duration?: number;
  action?: { label: ReactNode; onClick: () => void };
  title?: ReactNode;
}

interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title: ReactNode;
  description: ReactNode;
  duration: number;
  action?: { label: ReactNode; onClick: () => void };
}

interface ToastApi {
  success: (message: ReactNode, opts?: ToastOptions) => void;
  error: (message: ReactNode, opts?: ToastOptions) => void;
  info: (message: ReactNode, opts?: ToastOptions) => void;
  promise: <T>(
    p: Promise<T>,
    msgs: {
      loading: ReactNode;
      success: ReactNode | ((v: T) => ReactNode);
      error: ReactNode | ((e: unknown) => ReactNode);
    },
  ) => Promise<T>;
  dismiss: (id?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5000;

/**
 * `ToastProvider` (F1.5). Mount once near the app root. Renders the toast
 * viewport with the platform's placement: inline-end bottom on desktop, top
 * center on mobile. Auto-dismiss pauses on hover AND focus.
 *
 * At most `MAX_VISIBLE` (3) toasts are shown at once; older ones are dropped.
 * Errors use `role="alert"`, success/info use `role="status"`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const t = useTranslations('form.toast');

  const dismiss = useCallback((id?: string) => {
    setToasts((cur) => (id ? cur.filter((x) => x.id !== id) : []));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: ReactNode, opts: ToastOptions = {}) => {
      const id = `toast-${++idRef.current}`;
      const record: ToastRecord = {
        id,
        variant,
        title: opts.title ?? t(variant),
        description: opts.description ?? message,
        duration: opts.duration ?? DEFAULT_DURATION,
        action: opts.action,
      };
      setToasts((cur) => {
        const next = [...cur, record];
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
      });
      return id;
    },
    [t],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
      dismiss,
      promise: async <T,>(
        p: Promise<T>,
        msgs: {
          loading: ReactNode;
          success: ReactNode | ((v: T) => ReactNode);
          error: ReactNode | ((e: unknown) => ReactNode);
        },
      ): Promise<T> => {
        const loadingId = push('info', msgs.loading, { duration: 0 });
        try {
          const v = await p;
          dismiss(loadingId);
          push('success', typeof msgs.success === 'function' ? msgs.success(v) : msgs.success);
          return v;
        } catch (e) {
          dismiss(loadingId);
          push('error', typeof msgs.error === 'function' ? msgs.error(e) : msgs.error);
          throw e;
        }
      },
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider
        // Radix's swipe gesture API takes a physical direction; the viewport itself uses logical placement.
        swipeDirection="right" // rtl-ok
        duration={DEFAULT_DURATION}
      >
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            duration={toast.duration}
            onOpenChange={(open) => {
              if (!open) dismiss(toast.id);
            }}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-md border bg-surface p-3 shadow-md',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-full',
              'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
              'data-[swipe=cancel]:translate-x-0',
              'data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
              toast.variant === 'error' ? 'border-danger' : 'border-border-subtle',
            )}
          >
            <span className="mt-0.5 shrink-0">
              {toast.variant === 'success' ? (
                <CheckCircle2 size={18} className="text-success" />
              ) : toast.variant === 'error' ? (
                <AlertCircle size={18} className="text-danger" />
              ) : (
                <Info size={18} className="text-primary" />
              )}
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title className="text-sm font-medium text-text">
                {toast.title}
              </ToastPrimitive.Title>
              {toast.description ? (
                <ToastPrimitive.Description
                  className="text-xs text-text-subtle"
                  role={toast.variant === 'error' ? 'alert' : 'status'}
                >
                  {toast.description}
                </ToastPrimitive.Description>
              ) : null}
              {toast.action ? (
                <ToastPrimitive.Action
                  asChild
                  altText={typeof toast.action.label === 'string' ? toast.action.label : 'action'}
                >
                  <button
                    type="button"
                    onClick={toast.action.onClick}
                    className="mt-1 self-start text-xs font-medium text-primary hover:underline"
                  >
                    {toast.action.label}
                  </button>
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close asChild>
              <IconButton
                icon={X}
                aria-label={t('close')}
                className="-mt-1 -me-1 shrink-0 text-text-subtle hover:text-text"
              />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          className={cn(
            'fixed z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm',
            'bottom-4 end-4',
            'max-md:top-4 max-md:bottom-auto max-md:start-1/2 max-md:-translate-x-1/2 max-md:end-auto',
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
