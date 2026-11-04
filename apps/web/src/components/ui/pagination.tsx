'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/cn';
import { toDisplayDigits } from '../../lib/forms/digits';
import { IconButton } from './icon-button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
  className?: string;
}

/**
 * `Pagination` (F1.5). Page buttons with Persian digits in the `fa` locale,
 * previous/next buttons whose icons follow the reading direction (in RTL the
 * "previous" chevron points right), `aria-current="page"` on the active
 * button, and a compact mobile layout.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  siblingCount = 1,
  className,
}: PaginationProps) {
  const t = useTranslations('form.pagination');
  const locale = useLocale();

  const fmt = useCallback((n: number) => toDisplayDigits(String(n), locale), [locale]);

  if (totalPages <= 1) {
    return (
      <nav aria-label={t('current')} className={cn('text-sm text-text-subtle', className)}>
        {t('page', { page: fmt(page), total: fmt(totalPages) })}
      </nav>
    );
  }

  const range = buildRange(page, totalPages, siblingCount);

  const go = (p: number) => {
    const clamped = Math.max(1, Math.min(totalPages, p));
    if (clamped !== page) onPageChange(clamped);
  };

  return (
    <nav aria-label={t('current')} className={cn('flex items-center gap-1', className)}>
      <IconButton
        icon={ChevronRight}
        aria-label={t('previous')}
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="rtl:hidden"
      />
      <IconButton
        icon={ChevronLeft}
        aria-label={t('previous')}
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="hidden rtl:flex"
      />

      <ul className="flex items-center gap-1">
        {range.map((item, i) =>
          item === '…' ? (
            <li key={`ell-${i}`} className="px-1 text-text-subtle" aria-hidden="true">
              <MoreHorizontal size={16} />
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                onClick={() => go(item)}
                aria-current={item === page ? 'page' : undefined}
                aria-label={t('pageLabel', { page: fmt(item) })}
                className={cn(
                  'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  item === page
                    ? 'bg-primary text-on-primary font-medium'
                    : 'text-text hover:bg-surface-alt',
                )}
              >
                {fmt(item)}
              </button>
            </li>
          ),
        )}
      </ul>

      <IconButton
        icon={ChevronLeft}
        aria-label={t('next')}
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className="rtl:hidden"
      />
      <IconButton
        icon={ChevronRight}
        aria-label={t('next')}
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className="hidden rtl:flex"
      />

      <span className="ms-2 text-xs text-text-subtle max-md:hidden">
        {t('page', { page: fmt(page), total: fmt(totalPages) })}
      </span>
    </nav>
  );
}

function buildRange(page: number, total: number, sibling: number): Array<number | '…'> {
  const totalSlots = 1 + 1 + 1 + 2 * sibling + 2;
  if (total <= totalSlots) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const leftSibling = Math.max(page - sibling, 1);
  const rightSibling = Math.min(page + sibling, total);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < total - 1;

  const range: Array<number | '…'> = [1];
  if (showLeftEllipsis) range.push('…');
  for (let i = leftSibling; i <= rightSibling; i++) {
    if (i !== 1 && i !== total) range.push(i);
  }
  if (showRightEllipsis) range.push('…');
  range.push(total);
  return range;
}
