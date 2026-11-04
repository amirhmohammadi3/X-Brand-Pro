'use client';

import { type ReactNode } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { toDisplayDigits } from '../../lib/forms/digits';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  delta?: number;
  deltaUnit?: 'percent' | 'absolute' | 'currency';
  icon?: ReactNode;
  className?: string;
}

/**
 * `Stat` (F1.5). A single metric card: label, value, and an optional delta
 * with an arrow icon + text label (never color alone). Digits are Persian in
 * the `fa` locale.
 */
export function Stat({ label, value, delta, deltaUnit = 'absolute', icon, className }: StatProps) {
  const t = useTranslations('form.stat');
  const locale = useLocale();
  const isIncrease = delta !== undefined && delta > 0;
  const isDecrease = delta !== undefined && delta < 0;

  const deltaText =
    delta === undefined
      ? null
      : (() => {
          const abs = Math.abs(delta);
          const num = toDisplayDigits(String(abs), locale);
          const suffix = deltaUnit === 'percent' ? '%' : '';
          return `${num}${suffix}`;
        })();

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border-subtle bg-surface p-4',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm text-text-subtle">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-2xl font-semibold text-text">{value}</span>
      {deltaText ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium',
            isIncrease ? 'text-success' : isDecrease ? 'text-danger' : 'text-text-subtle',
          )}
        >
          {isIncrease ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : isDecrease ? (
            <ArrowDown size={12} aria-hidden="true" />
          ) : null}
          <span>
            {deltaText}{' '}
            <span className="text-text-subtle">
              {isIncrease ? t('increase') : isDecrease ? t('decrease') : ''}
            </span>
          </span>
        </span>
      ) : null}
    </div>
  );
}
