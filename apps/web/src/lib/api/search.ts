// src/lib/api/search.ts — search-surface hooks (F3.6): auto-suggest,
// per-user history, popular queries. All endpoints are the B3.3/B3.5
// contracts; every response is schema-validated by `apiFetch`.
//
// History treats a 401 as "anonymous visitor" — the endpoint is
// authenticated and anonymous callers (and expired tokens) simply see no
// recent-searches UI instead of an error banner. `useSuggest` is the
// typeahead query: short stale time, no retries (typeahead re-fires on the
// next keystroke anyway) and `placeholderData` so the list does not flash
// empty between keystrokes.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  clearSearchHistoryResultSchema,
  popularQueriesResultSchema,
  publicCitySchema,
  searchHistoryResultSchema,
  suggestResultSchema,
  type ClearSearchHistoryResult,
  type PopularQueriesResult,
  type PublicCity,
  type SearchHistoryResult,
  type SuggestResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { ApiRequestError } from './errors';
import { qk } from './qk';

const SUGGEST_MIN_STALE_SEC = 30;
const HISTORY_STALE_SEC = 60;
const POPULAR_STALE_SEC = 300;

/** Auto-suggest typeahead (`GET /search/suggest`, B3.3, rate 120/min/ip).
 * `enabled` is the debounce/length gate the SearchBox applies. */
export function useSuggest(
  params: { q: string; cityId?: string; limit?: number },
  options: { enabled?: boolean } = {},
): UseQueryResult<SuggestResult> {
  const q = params.q.trim();
  return useQuery({
    queryKey: qk.search.suggest(q, params.cityId, params.limit ?? 8),
    queryFn: async ({ signal }) => {
      const { data } = await apiFetch('/search/suggest', suggestResultSchema, {
        query: { q, cityId: params.cityId, limit: params.limit ?? 8 },
        signal,
      });
      return data;
    },
    enabled: (options.enabled ?? true) && q.length >= 2,
    staleTime: SUGGEST_MIN_STALE_SEC * 1000,
    retry: 0,
  });
}

/** The logged-in user's recent searches (`GET /search/history`, B3.5).
 * A 401 (anonymous visitor or expired token) resolves to an EMPTY list —
 * the caller renders nothing rather than an error. */
export function useSearchHistory(
  options: { limit?: number } = {},
): UseQueryResult<SearchHistoryResult> {
  return useQuery({
    queryKey: qk.search.history(options.limit ?? 10),
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiFetch('/search/history', searchHistoryResultSchema, {
          query: { limit: options.limit ?? 10 },
          signal,
        });
        return data;
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          return { items: [] } satisfies SearchHistoryResult;
        }
        throw err;
      }
    },
    staleTime: HISTORY_STALE_SEC * 1000,
    retry: 0,
  });
}

/** Clear the user's whole history (`DELETE /search/history`, B3.5). */
export function useClearSearchHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ClearSearchHistoryResult> => {
      const { data } = await apiFetch('/search/history', clearSearchHistoryResultSchema, {
        method: 'DELETE',
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.search.historyAll() });
    },
  });
}

/** Remove one history entry (`DELETE /search/history/:id`, B3.5). */
export function useRemoveSearchHistoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ deleted: 1 }> => {
      const { data } = await apiFetch(`/search/history/${id}`, clearSearchHistoryResultSchema, {
        method: 'DELETE',
      });
      return data as unknown as { deleted: 1 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.search.historyAll() });
    },
  });
}

/** Popular ("trending") queries (`GET /search/popular`, B3.5, public). */
export function usePopularQueries(
  params: { cityId?: string; limit?: number } = {},
): UseQueryResult<PopularQueriesResult> {
  return useQuery({
    queryKey: qk.search.popular(params.cityId, params.limit ?? 10),
    queryFn: async ({ signal }) => {
      const { data } = await apiFetch('/search/popular', popularQueriesResultSchema, {
        query: { cityId: params.cityId, limit: params.limit ?? 10 },
        signal,
      });
      return data;
    },
    staleTime: POPULAR_STALE_SEC * 1000,
    retry: 0,
  });
}

// ---------------------------------------------------------------------------
// Business search (B3.2) + map data (B3.4) — F3.4's search page
// ---------------------------------------------------------------------------

import {
  mapResultSchema,
  searchResultSchema,
  type MapResult,
  type SearchResult,
} from '@app/contracts';

/** The search query as the page holds it (URL-synced). */
export interface BusinessSearchParams {
  q?: string;
  cityId?: string;
  neighborhoodId?: string;
  categoryIds?: string[];
  amenityIds?: string[];
  minRating?: number;
  priceLevel?: number;
  sort?: 'relevance' | 'rating' | 'distance' | 'newest';
  page?: number;
  pageSize?: number;
}

/** `GET /search` (B3.2) — ranked, paginated hits for the results list. */
export function useBusinessSearch(
  params: BusinessSearchParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<SearchResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const queryKey = qk.search.results(params);
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const { data } = await apiFetch('/search', searchResultSchema, {
        query: {
          q: params.q,
          cityId: params.cityId,
          neighborhoodId: params.neighborhoodId,
          categoryIds: params.categoryIds,
          amenityIds: params.amenityIds,
          minRating: params.minRating,
          priceLevel: params.priceLevel,
          sort: params.sort,
          page,
          pageSize,
        },
        signal,
      });
      return data;
    },
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    retry: 0,
    placeholderData: (previous) => previous,
  });
}

/** `GET /map/businesses` (B3.4) — clusters or points for the viewport. The
 * key is the exact bbox string MapView emits (5-decimal corners), so the
 * server's 3-decimal quantized cache still dedupes jitter client-side. */
export function useMapBusinesses(
  params: { bbox?: string; zoom?: number; cityId?: string },
  options: { enabled?: boolean } = {},
): UseQueryResult<MapResult> {
  const { bbox, zoom, cityId } = params;
  return useQuery({
    queryKey: qk.search.map(bbox, zoom, cityId),
    queryFn: async ({ signal }) => {
      const { data } = await apiFetch('/map/businesses', mapResultSchema, {
        query: { bbox, zoom, cityId },
        signal,
      });
      return data;
    },
    enabled:
      (options.enabled ?? true) &&
      typeof bbox === 'string' &&
      bbox.length > 0 &&
      typeof zoom === 'number',
    staleTime: 30_000,
    retry: 0,
    placeholderData: (previous) => previous,
  });
}

/** `GET /cities` (B2.1 public) — the city filter's options. */
export function useCities(): UseQueryResult<PublicCity[]> {
  return useQuery({
    queryKey: ['cities', 'public'] as const,
    queryFn: async ({ signal }) => {
      const { data } = await apiFetch('/cities', z.object({ items: z.array(publicCitySchema) }), {
        signal,
      });
      return data.items;
    },
    staleTime: 300_000,
    retry: 0,
  });
}
