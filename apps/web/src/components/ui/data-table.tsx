'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { Checkbox } from './form/checkbox';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';

export type SortDir = 'asc' | 'desc' | null;

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  emptyMessage?: ReactNode;
  sort?: { columnId: string; dir: SortDir };
  onSortChange?: (sort: { columnId: string; dir: SortDir } | null) => void;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  skeletonRows?: number;
  renderMobileCard?: (row: T, index: number) => ReactNode;
  className?: string;
}

/**
 * `DataTable<T>` (F1.5). A sortable, selectable, responsive data table.
 *
 * - **Sorting**: sortable headers render a keyboard-accessible button with
 *   `aria-sort` on the `<th>`. Clicking cycles none → asc → desc → none.
 * - **Selection**: a header checkbox selects/deselects all visible rows;
 *   each row has its own. Controlled via `selectedKeys`.
 * - **States**: `loading` shows skeleton rows; `error` shows the error slot
 *   with a retry; empty rows show the empty state.
 * - **Responsive**: under 768px, if `renderMobileCard` is provided, rows
 *   render as cards instead of a table.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  emptyMessage,
  sort,
  onSortChange,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  skeletonRows = 5,
  renderMobileCard,
  className,
}: DataTableProps<T>) {
  const t = useTranslations('form.table');
  const [internalSort, setInternalSort] = useState<{ columnId: string; dir: SortDir } | null>(null);
  const activeSort = sort ?? internalSort;

  const toggleSort = useCallback(
    (columnId: string) => {
      const next: { columnId: string; dir: SortDir } | null = (() => {
        if (!activeSort || activeSort.columnId !== columnId) return { columnId, dir: 'asc' };
        if (activeSort.dir === 'asc') return { columnId, dir: 'desc' };
        if (activeSort.dir === 'desc') return null;
        return { columnId, dir: 'asc' };
      })();
      if (sort === undefined) setInternalSort(next);
      onSortChange?.(next);
    },
    [activeSort, sort, onSortChange],
  );

  const allKeys = useMemo(() => rows.map((r, i) => rowKey(r, i)), [rows, rowKey]);
  const allSelected =
    selectable && allKeys.length > 0 && allKeys.every((k) => selectedKeys.includes(k));

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : allKeys);
  }, [allSelected, allKeys, onSelectionChange]);

  const toggleRow = useCallback(
    (key: string) => {
      if (!onSelectionChange) return;
      onSelectionChange(
        selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key],
      );
    },
    [selectedKeys, onSelectionChange],
  );

  const ariaSort = (colId: string): 'ascending' | 'descending' | 'none' => {
    if (!activeSort || activeSort.columnId !== colId) return 'none';
    return activeSort.dir === 'asc' ? 'ascending' : 'descending';
  };

  if (error) {
    return (
      <div className={cn('rounded-md border border-border-subtle p-4', className)}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const showMobile = renderMobileCard !== undefined;

  return (
    <div className={cn('w-full', className)}>
      {/* Desktop table */}
      <div className={cn('hidden md:block', showMobile && 'max-md:hidden')}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-alt">
            <tr className="border-b border-border">
              {selectable ? (
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    label={<span className="sr-only">{t('selectAll')}</span>}
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
              ) : null}
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={col.sortable ? ariaSort(col.id) : undefined}
                  className={cn('px-3 py-2 text-start font-medium text-text-subtle', col.className)}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      aria-label={
                        ariaSort(col.id) === 'ascending' ? t('sortDescending') : t('sortAscending')
                      }
                      className="inline-flex items-center gap-1 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {col.header}
                      {activeSort?.columnId === col.id ? (
                        activeSort.dir === 'asc' ? (
                          <ArrowUp size={14} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={14} aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown size={14} aria-hidden="true" className="opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border-subtle">
                  {selectable ? (
                    <td className="px-3 py-2">
                      <Skeleton className="h-4 w-4" />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td key={col.id} className="px-3 py-2">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-8">
                  <EmptyState icon={Inbox} title={String(emptyMessage ?? t('empty'))} />
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const key = rowKey(row, i);
                const selected = selectedKeys.includes(key);
                return (
                  <tr
                    key={key}
                    data-selected={selected || undefined}
                    className="border-b border-border-subtle hover:bg-surface-alt/50"
                  >
                    {selectable ? (
                      <td className="px-3 py-2">
                        <Checkbox
                          label={<span className="sr-only">{t('selectRow')}</span>}
                          checked={selected}
                          onChange={() => toggleRow(key)}
                        />
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td key={col.id} className={cn('px-3 py-2 text-text', col.className)}>
                        {col.cell(row, i)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {loading ? (
          <p className="sr-only" role="status">
            {t('loading')}
          </p>
        ) : null}
      </div>

      {/* Mobile cards */}
      {showMobile ? (
        <div className="md:hidden flex flex-col gap-2">
          {loading ? (
            Array.from({ length: Math.min(skeletonRows, 3) }).map((_, i) => (
              <Skeleton key={`msk-${i}`} className="h-20 w-full rounded-md" />
            ))
          ) : rows.length === 0 ? (
            <EmptyState icon={Inbox} title={String(emptyMessage ?? t('empty'))} />
          ) : (
            rows.map((row, i) => (
              <div key={rowKey(row, i)} className="rounded-md border border-border-subtle p-3">
                {renderMobileCard!(row, i)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
