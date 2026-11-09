'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataTableColumn, type SortDir } from '../ui/data-table';
import { Pagination } from '../ui/pagination';
import { cn } from '../../lib/cn';
import { toDisplayDigits } from '../../lib/forms/digits';

/**
 * `AdminTable<T>` (F2.1) — the shared chrome every admin list page composes:
 * an optional toolbar slot (search, filters, create button), the F1.5
 * `DataTable` (skeleton / error / empty states included) and a server-side
 * pagination footer with the total count in locale digits.
 *
 * Sorting stays client-side here (the current admin lists are small); when a
 * list grows a server-sort the page passes `sort`/`onSortChange` through.
 */
export interface AdminTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T> | undefined;
  /** Total matching rows across all pages (for the footer + page count). */
  total: number | undefined;
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  rowKey: (row: T, index: number) => string;
  /** Search box, filter chips, primary create button … */
  toolbar?: ReactNode;
  /** Under 768px rows render as cards instead of the table. */
  renderMobileCard?: (row: T, index: number) => ReactNode;
  /** Shown when the page has no rows; DataTable falls back to its default. */
  emptyTitle?: string;
  sort?: { columnId: string; dir: SortDir };
  onSortChange?: (sort: { columnId: string; dir: SortDir } | null) => void;
  skeletonRows?: number;
  className?: string;
}

export function AdminTable<T>({
  columns,
  rows,
  total,
  loading,
  error,
  onRetry,
  page,
  pageSize,
  onPageChange,
  rowKey,
  toolbar,
  renderMobileCard,
  emptyTitle,
  sort,
  onSortChange,
  skeletonRows = 5,
  className,
}: AdminTableProps<T>) {
  const t = useTranslations('admin.table');
  const locale = useLocale();

  const totalPages = Math.max(1, Math.ceil((total ?? 0) / pageSize));
  // `error` is `unknown` at the boundary (pages pass ApiRequestError); the
  // DataTable renders any truthy value through ErrorState.
  const errorNode = (error ?? undefined) as ReactNode | undefined;

  return (
    <div className={cn('space-y-3', className)}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}

      <DataTable
        columns={columns}
        rows={rows ?? []}
        rowKey={rowKey}
        loading={loading}
        error={errorNode}
        onRetry={onRetry}
        emptyMessage={emptyTitle}
        sort={sort}
        onSortChange={onSortChange}
        skeletonRows={skeletonRows}
        renderMobileCard={renderMobileCard}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-subtle">
          {t('total', { count: toDisplayDigits(String(total ?? 0), locale) })}
        </p>
        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      </div>
    </div>
  );
}
