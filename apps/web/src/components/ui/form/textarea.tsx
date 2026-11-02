import { forwardRef, useId, useLayoutEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';
import { toDisplayDigits } from '../../../lib/forms/digits';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Show the "{count} of {max}" counter when `maxLength` is set. */
  showCounter?: boolean;
}

/**
 * `Textarea` (F1.4). Auto-grows to fit its content up to a max height, and
 * shows a localized character counter (`{count} of {max}`) when `maxLength`
 * is set. The counter uses Persian digits in the `fa` locale.
 *
 * Auto-grow is done by mirroring `scrollHeight` into the `height` style on
 * every input; a max-height via the `rows`/CSS keeps it bounded.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, maxLength, showCounter = true, value, onChange, ...rest },
  ref,
) {
  const t = useTranslations('form');
  const locale = useLocale();
  const fallbackId = useId();
  const id = rest.id ?? fallbackId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setBothRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };

  const grow = () => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    grow();
    // Re-grow when value changes externally.
  }, [value]);

  const len = typeof value === 'string' ? value.length : 0;
  const counterId = `${id}-counter`;

  return (
    <span className="flex flex-col gap-1">
      <textarea
        ref={setBothRefs}
        id={id}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          grow();
        }}
        maxLength={maxLength}
        aria-describedby={maxLength && showCounter ? counterId : undefined}
        className={cn(
          'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text',
          'min-h-[calc(var(--control-h)*1.5)] resize-none overflow-hidden',
          'placeholder:text-text-subtle',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'aria-[invalid=true]:border-danger',
          className,
        )}
        {...rest}
      />
      {maxLength && showCounter ? (
        <span id={counterId} className="text-end text-xs text-text-subtle" aria-live="polite">
          {t('characterCount', {
            count: toDisplayDigits(String(len), locale),
            max: toDisplayDigits(String(maxLength), locale),
          })}
        </span>
      ) : null}
    </span>
  );
});
