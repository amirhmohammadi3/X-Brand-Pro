'use client';

import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  useClearSearchHistory,
  useRemoveSearchHistoryItem,
  useSearchHistory,
} from '@/lib/api/search';

/**
 * Recent-searches chips (F3.6) over `GET /search/history` (B3.5). Anonymous
 * visitors (the hook resolves 401 → empty) and users with no history render
 * NOTHING — the block simply doesn't appear, no skeleton, no empty state.
 *
 * A chip re-runs that search (`/search?q=…` — F3.4's page); the × removes one
 * entry (`DELETE /search/history/:id`) and «پاک کردن همه» clears the list
 * (`DELETE /search/history`). Both mutations invalidate `qk.search.historyAll`.
 */
export function RecentSearches({ limit = 6 }: { limit?: number }) {
  const t = useTranslations('search.recent');
  const router = useRouter();
  const history = useSearchHistory({ limit });
  const removeOne = useRemoveSearchHistoryItem();
  const clearAll = useClearSearchHistory();

  const items = history.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-label={t('title')}
      data-testid="recent-searches"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-sm text-muted">{t('title')}:</span>
      {items.map((item) => (
        <span
          key={item.id}
          data-testid="recent-chip"
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface px-3 py-1 text-sm text-text"
        >
          <button
            type="button"
            data-testid="recent-chip-link"
            className="hover:text-primary"
            onClick={() => router.push({ pathname: '/search', query: { q: item.text } })}
          >
            {item.text}
          </button>
          <button
            type="button"
            aria-label={t('removeOne', { query: item.text })}
            data-testid="recent-chip-remove"
            className="text-muted hover:text-danger"
            disabled={removeOne.isPending}
            onClick={() => removeOne.mutate(item.id)}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        data-testid="recent-clear"
        className="text-sm text-muted underline underline-offset-4 hover:text-danger"
        disabled={clearAll.isPending}
        onClick={() => clearAll.mutate()}
      >
        {t('clear')}
      </button>
    </section>
  );
}
