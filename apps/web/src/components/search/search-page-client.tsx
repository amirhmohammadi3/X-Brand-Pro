'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { MapViewport as Viewport } from '@/lib/map/geojson';
import type { BusinessSearchParams } from '@/lib/api/search';
import { useBusinessSearch, useCities, useMapBusinesses } from '@/lib/api/search';
import { SearchBox } from './search-box';
import { BusinessCard } from '@/components/business/business-card';
import { MapView } from '@/components/map/map-view';
import { BottomSheet } from '@/components/ui/bottom-sheet';

/**
 * The map-centric search page client (F3.4). DESIGN.md §1/§13: full-height
 * map + a results sheet (side panel on desktop, bottom sheet on mobile),
 * list ↔ map working on the SAME query.
 *
 * Data flow (single source of truth = the `filters` state, URL-synced):
 * - filters → `useBusinessSearch` (the list, B3.2 ranking + facets)
 * - filters + viewport → `useMapBusinesses` (B3.4 clusters/points for the
 *   viewport; moveend throttles the emission, the server's quantized cache
 *   absorbs jitter, `placeholderData` keeps the previous layer visible while
 *   the next viewport loads — no flash on pan)
 * - the map itself is dumb: MapView renders whatever `data` holds; the mode
 *   switch (clusters ↔ points) follows the B3.4 threshold via the shared
 *   MAP_POINT_ZOOM_MIN contract constant.
 */
export interface SearchPageClientProps {
  /** URL-derived initial filters (server component parses ?q=&cityId=…). */
  initialFilters: BusinessSearchParams;
}

export function SearchPageClient({ initialFilters }: SearchPageClientProps) {
  const t = useTranslations('search');
  const router = useRouter();
  const locale = useLocale();
  const [filters, setFilters] = useState<BusinessSearchParams>(initialFilters);
  const [page, setPage] = useState(1);

  // Recent-search chips (F3.6) push /search?q=… — on this route that is a
  // URL change the server component re-parses into a NEW initialFilters.
  // Sync the client state with it (serialized compare avoids loops).
  const initialKey = JSON.stringify(initialFilters);
  const lastInitialKey = useRef(initialKey);
  useEffect(() => {
    if (lastInitialKey.current === initialKey) return;
    lastInitialKey.current = initialKey;
    setFilters(initialFilters);
    setPage(1);
  }, [initialKey, initialFilters]);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);

  const cities = useCities();

  const list = useBusinessSearch({ ...filters, page, pageSize: 20 });
  const mapData = useMapBusinesses({
    bbox: viewport?.bbox,
    zoom: viewport?.zoom,
    cityId: filters.cityId,
  });

  /** Sync filters → the /search URL (shareable + SEO-consistent states). */
  const replaceUrl = useCallback(
    (next: BusinessSearchParams) => {
      const qs = new URLSearchParams();
      if (next.q) qs.set('q', next.q);
      if (next.cityId) qs.set('cityId', next.cityId);
      if (next.neighborhoodId) qs.set('neighborhoodId', next.neighborhoodId);
      if (next.categoryIds?.length) qs.set('categoryIds', next.categoryIds.join(','));
      if (next.amenityIds?.length) qs.set('amenityIds', next.amenityIds.join(','));
      if (next.minRating !== undefined) qs.set('minRating', String(next.minRating));
      if (next.priceLevel !== undefined) qs.set('priceLevel', String(next.priceLevel));
      if (next.sort) qs.set('sort', next.sort);
      const query = qs.toString();
      router.replace(query === '' ? '/search' : `/search?${query}`);
    },
    [router],
  );

  const updateFilters = useCallback(
    (patch: Partial<BusinessSearchParams>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        replaceUrl(next);
        return next;
      });
      setPage(1);
    },
    [replaceUrl],
  );

  const onViewportChange = useCallback((v: Viewport) => setViewport(v), []);

  const hits = list.data?.items ?? [];
  const meta = list.data?.meta ?? null;

  const sortOptions = useMemo(
    () => [
      { value: 'relevance', label: t('sort.relevance') },
      { value: 'rating', label: t('sort.rating') },
      { value: 'newest', label: t('sort.newest') },
    ],
    [t],
  );

  const resultsList = (
    <div className="flex flex-col gap-3" data-testid="search-results">
      {list.isFetching && hits.length === 0 ? (
        <p className="text-sm text-muted" data-testid="search-results-loading">
          {t('loading')}
        </p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted" data-testid="search-results-empty">
          {t('noResults')}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted" data-testid="search-results-count">
            {t('resultsCount', { count: meta?.total ?? 0 })}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {hits.map((hit) => (
              <BusinessCard key={hit.id} hit={hit} locale={locale} />
            ))}
          </div>
          {meta !== null && meta.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                data-testid="search-page-prev"
                className="rounded-md border border-border-subtle px-3 py-1 text-sm text-text disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('pagination.prev')}
              </button>
              <span className="text-xs tabular-nums text-muted">
                {page} / {meta.totalPages}
              </span>
              <button
                type="button"
                data-testid="search-page-next"
                className="rounded-md border border-border-subtle px-3 py-1 text-sm text-text disabled:opacity-40"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('pagination.next')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2" data-testid="search-filters">
      <select
        aria-label={t('filters.city')}
        data-testid="filter-city"
        className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-sm text-text"
        value={filters.cityId ?? ''}
        onChange={(e) =>
          updateFilters({ cityId: e.target.value === '' ? undefined : e.target.value })
        }
      >
        <option value="">{t('filters.allCities')}</option>
        {(cities.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name.fa ?? c.name.en ?? c.slug}
          </option>
        ))}
      </select>
      <select
        aria-label={t('filters.minRating')}
        data-testid="filter-rating"
        className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-sm text-text"
        value={filters.minRating ?? ''}
        onChange={(e) =>
          updateFilters({ minRating: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      >
        <option value="">{t('filters.anyRating')}</option>
        {[3, 3.5, 4, 4.5].map((r) => (
          <option key={r} value={r}>
            {t('filters.minRatingValue', { value: r })}
          </option>
        ))}
      </select>
      <select
        aria-label={t('filters.sort')}
        data-testid="filter-sort"
        className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-sm text-text"
        value={filters.sort ?? 'rating'}
        onChange={(e) => updateFilters({ sort: e.target.value as BusinessSearchParams['sort'] })}
      >
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex min-h-[70dvh] flex-col" data-testid="search-page">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <SearchBox
          cityId={filters.cityId}
          placeholder={t('placeholder')}
          onSubmitRawQuery={(q) => updateFilters({ q })}
        />
        <div className="mt-3">{filterBar}</div>
      </div>

      {/* Desktop: map + side panel. Mobile: map + bottom sheet (DESIGN.md §1). */}
      <div className="mt-4 grid flex-1 grid-cols-1 gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-[3fr_2fr]">
        <div className="relative h-[50dvh] lg:h-[70dvh]" data-testid="search-map-pane">
          <MapView
            data={mapData.data ?? null}
            onViewportChange={onViewportChange}
            className="h-full w-full rounded-xl"
          />
        </div>
        <div className="hidden lg:block" data-testid="search-side-panel">
          {resultsList}
        </div>
        <div className="lg:hidden">
          <BottomSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t('resultsTitle')}
            defaultSnap="half"
            modal={false}
          >
            {resultsList}
          </BottomSheet>
        </div>
      </div>
    </div>
  );
}
