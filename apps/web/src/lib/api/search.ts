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
import {
  clearSearchHistoryResultSchema,
  popularQueriesResultSchema,
  searchHistoryResultSchema,
  suggestResultSchema,
  type ClearSearchHistoryResult,
  type PopularQueriesResult,
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
