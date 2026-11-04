'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';

export interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * `CopyButton` (F1.5). Copies `value` to the clipboard and shows a "Copied"
 * confirmation for ~2s. The icon swaps to a check, so both sighted and
 * screen-reader users get feedback without polling the clipboard.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  iconOnly = false,
  className,
  disabled = false,
}: CopyButtonProps) {
  const t = useTranslations('form.copy');
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonId = useId();

  const handleCopy = useCallback(async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — no-op.
    }
  }, [disabled, value]);

  const accessibleLabel = copied ? (copiedLabel ?? t('copied')) : (label ?? t('copy'));

  if (iconOnly) {
    return (
      <button
        id={buttonId}
        type="button"
        onClick={handleCopy}
        disabled={disabled}
        aria-label={accessibleLabel}
        aria-pressed={copied}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-md',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          copied ? 'text-success' : 'text-text-subtle hover:text-text hover:bg-surface-alt',
          className,
        )}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleCopy}
      disabled={disabled || copied}
      className={className}
      aria-label={accessibleLabel}
      aria-pressed={copied}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{accessibleLabel}</span>
    </Button>
  );
}
