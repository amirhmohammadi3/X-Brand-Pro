import { useCallback, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { IconButton } from '../icon-button';

export interface CopyFieldProps {
  value: string;
  /** Visible label for screen readers. */
  label?: string;
  /** Always render LTR (useful for codes, URLs). */
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * `CopyField` (F1.4). A read-only text box with a copy-to-clipboard button.
 * The value is always selectable; the button exposes a localized, accessible
 * name that flips to "Copied" for ~2s after a successful copy so AT users get
 * feedback without polling the clipboard.
 */
export function CopyField({ value, label, dir, disabled = false, className, id }: CopyFieldProps) {
  const t = useTranslations('form.copy');
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable (e.g. non-secure context); fall back
      // to selecting the field so the user can copy manually.
      (document.getElementById(fieldId) as HTMLInputElement | null)?.select();
    }
  }, [disabled, value, fieldId]);

  return (
    <span className={cn('relative inline-flex w-full items-center', className)}>
      <input
        id={fieldId}
        type="text"
        readOnly
        value={value}
        dir={dir}
        aria-label={label}
        disabled={disabled}
        onFocus={(e) => e.target.select()}
        className={cn(
          'w-full rounded-md border border-border bg-surface-alt px-3 pe-10 text-sm text-text',
          'h-[var(--control-h)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50',
        )}
      />
      <span className="absolute inset-inline-end-0 flex items-center pe-1">
        <IconButton
          type="button"
          icon={copied ? Check : Copy}
          aria-label={copied ? t('copied') : t('copy')}
          aria-pressed={copied}
          onClick={handleCopy}
          disabled={disabled}
          className={copied ? 'text-success' : 'text-text-subtle hover:text-text'}
        />
      </span>
    </span>
  );
}
