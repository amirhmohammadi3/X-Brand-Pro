'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { createFormatters } from '../../lib/format';

export type RatingSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<RatingSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const STEP = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

interface RatingBaseProps {
  /** 0–5, supports halves (e.g. 4.5). */
  value: number;
  size?: RatingSize;
  className?: string;
}

interface DisplayRatingProps extends RatingBaseProps {
  readOnly?: true;
  onValueChange?: never;
}

interface InputRatingProps extends RatingBaseProps {
  readOnly?: false;
  onValueChange: (value: number) => void;
}

export type RatingProps = DisplayRatingProps | InputRatingProps;

/**
 * `Rating` (F1.3).
 *
 * Display mode (`readOnly`): 0–5 with half stars; the accessible label is
 * `ui.rating.label` with ICU `{value}` / `{max}` («امتیاز ۴٫۵ از ۵») and the
 * digits are Persian in `fa` via `formatNumber`.
 *
 * Input mode: a radiogroup of 10 radio inputs (one per half-step) so arrow
 * keys work and screen readers announce the choices. Arrow-key direction is
 * RTL-aware: in RTL, ArrowLeft increases and ArrowRight decreases (the visual
 * direction the stars flow), the mirror of LTR. Hover previews the value
 * under the pointer.
 */
export function Rating(props: RatingProps) {
  const { value, size = 'md', className, readOnly = true } = props;
  const t = useTranslations('ui');
  // Rating digits are formatted in fa per DESIGN.md (Persian digits for fa);
  // createFormatters is a pure factory so this is deterministic in tests.
  const { formatNumber } = createFormatters('fa' as never);

  const clamped = Math.max(0, Math.min(5, value));

  if (readOnly) {
    const label = t('rating.label', { value: formatNumber(clamped), max: formatNumber(5) });
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-flex items-center gap-0.5 text-warning', className)}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = clamped - i;
          return (
            <span key={i} className="relative inline-block">
              <Star aria-hidden className={cn(SIZE_CLASS[size], 'text-border-subtle')} />
              {filled > 0 ? (
                <span
                  className="rating-half absolute inset-y-0"
                  style={filled >= 1 ? { width: '100%' } : { width: '50%' }}
                >
                  <Star aria-hidden className={cn(SIZE_CLASS[size], 'text-warning fill-current')} />
                </span>
              ) : null}
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <RatingInput
      value={clamped}
      size={size}
      className={className}
      onValueChange={(props as InputRatingProps).onValueChange}
    />
  );
}

function RatingInput({
  value,
  size,
  className,
  onValueChange,
}: {
  value: number;
  size: RatingSize;
  className?: string;
  onValueChange: (v: number) => void;
}) {
  const t = useTranslations('ui');
  const { formatNumber } = createFormatters('fa' as never);
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const isRtl = document.documentElement.dir === 'rtl';
    const idx = STEP.indexOf(value as (typeof STEP)[number]);
    let next = idx;
    const increase = isRtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
    const decrease = isRtl ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';
    if (increase) next = Math.min(STEP.length - 1, idx + 1);
    else if (decrease) next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = STEP.length - 1;
    else return;
    e.preventDefault();
    const stepValue = STEP[next];
    if (stepValue !== undefined) onValueChange(stepValue);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('rating.inputLabel')}
      tabIndex={0}
      onKeyDown={handleKey}
      onMouseLeave={() => setHover(null)}
      className={cn(
        'inline-flex items-center gap-0.5 text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
        className,
      )}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = display - i;
        return (
          <label
            key={i}
            className="relative inline-block cursor-pointer"
            onMouseEnter={() => setHover(i + 1)}
          >
            {STEP.filter((s) => Math.floor(s) === i || (s > i && s < i + 1)).map((s) => (
              <input
                key={s}
                type="radio"
                name="rating"
                value={s}
                checked={value === s}
                onChange={() => onValueChange(s)}
                className="sr-only"
                aria-label={t('rating.star', { value: formatNumber(s) })}
              />
            ))}
            <Star
              aria-hidden
              className={cn(
                SIZE_CLASS[size],
                filled > 0 ? 'text-warning fill-current' : 'text-border-subtle',
              )}
            />
          </label>
        );
      })}
    </div>
  );
}
