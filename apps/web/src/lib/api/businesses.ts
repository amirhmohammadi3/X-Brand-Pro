'use client';

/**
 * Businesses API hooks (F7.1). The owner dashboard reads the caller's own
 * businesses (every status) and the B7.2 analytics stats for the selected
 * one. Every JSON call goes through the shared `apiFetch` (envelope-validated
 * with the contract schemas) and TanStack Query.
 *
 * Cache strategy:
 * - `useMyBusinesses()` is keyed once per user (`qk.businesses.mine()`). A
 *   registration or status transition invalidates the whole subtree so the
 *   `/dashboard` cards and every per-business selector dropdown refresh
 *   together — a just-registered business appears in the switcher at once.
 * - `useBusinessStats(businessId, window)` is keyed by (business, window);
 *   the F7.1 overview and the F7.8 charts page share the key so a window
 *   change refetches once.
 */
import { useQuery } from '@tanstack/react-query';
import {
  analyticsStatsResultSchema,
  myBusinessesResultSchema,
  type AnalyticsStatsResult,
  type BusinessSummary,
  type MyBusinessesResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { qk } from './qk';

/**
 * `GET /businesses/me` — the caller's businesses (every status). Returns a
 * stable empty array while loading so callers can `.map` without a null
 * guard; `isPending` distinguishes "loading" from "owner has no businesses".
 */
export function useMyBusinesses(): {
  businesses: BusinessSummary[];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<MyBusinessesResult>({
    queryKey: qk.businesses.mine(),
    queryFn: async () => {
      const result = await apiFetch('/businesses/me', myBusinessesResultSchema);
      return result.data;
    },
    staleTime: 30_000,
  });
  return {
    businesses: query.data?.items ?? [],
    isPending: query.isPending,
    error: query.error,
  };
}

/**
 * `GET /analytics/business/:id/stats` — the B7.2 owner read (series + totals)
 * for a window. `from`/`to` are `YYYY-MM-DD` business-local; both omitted →
 * the API's default last-30-days window. Disabled until a businessId is
 * known so the overview can mount before the id resolves.
 */
export function useBusinessStats(
  businessId: string | null | undefined,
  window?: { from?: string; to?: string },
): {
  stats: AnalyticsStatsResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<AnalyticsStatsResult>({
    queryKey: qk.analytics.stats(businessId ?? '', window?.from, window?.to),
    queryFn: async () => {
      const result = await apiFetch(
        `/analytics/business/${businessId as string}/stats`,
        analyticsStatsResultSchema,
        { query: { from: window?.from, to: window?.to } },
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });
  return { stats: query.data ?? null, isPending: query.isPending, error: query.error };
}
