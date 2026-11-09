'use client';

import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { usePopularQueries } from '@/lib/api/search';

/**
 * Popular ("trending") query chips (F3.6) over `GET /search/popular` (B3.5,
 * public). Renders nothing while the counters are still empty (a fresh
 * deployment has no popularity rows yet). Used by the home page (F3.3) and
 * city pages (F3.5 pass a cityId).
 */
export function PopularQueries({ cityId, limit = 8 }: { cityId?: string; limit?: number }) {
  const t = useTranslations('search.popular');
  const router = useRouter();
  const popular = usePopularQueries({ cityId, limit });

  const items = popular.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-label={t('title')}
      data-testid="popular-queries"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-sm text-muted">{t('title')}:</span>
      {items.map((item) => (
        <button
          key={`${item.text}:${item.cityId ?? 'all'}`}
          type="button"
          data-testid="popular-chip"
          className="rounded-full bg-surface-alt px-3 py-1 text-sm text-text hover:text-primary"
          onClick={() => {
            // City-scoped rows keep their scope when re-run; global rows search globally.
            router.push({
              pathname: '/search',
              query: item.cityId ? { q: item.text, cityId: item.cityId } : { q: item.text },
            });
          }}
        >
          {item.text}
        </button>
      ))}
    </section>
  );
}
