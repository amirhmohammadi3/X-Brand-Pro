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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  analyticsStatsResultSchema,
  businessDetailSchema,
  myBusinessesResultSchema,
  type AnalyticsStatsResult,
  type BusinessDetail,
  type BusinessSummary,
  type MyBusinessesResult,
  type UpdateBusinessBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
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

/**
 * `GET /businesses/:id` — the owner's full detail (ownership gated by the
 * API). Used by the F7.2 profile editor to populate the form. Disabled until
 * a businessId is known.
 */
export function useBusinessDetail(businessId: string | null | undefined): {
  business: BusinessDetail | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<BusinessDetail>({
    queryKey: qk.businesses.detail(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch(`/businesses/${businessId as string}`, businessDetailSchema);
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { business: query.data ?? null, isPending: query.isPending, error: query.error };
}

/**
 * `PATCH /businesses/:id` — partial update of the editable scalar fields
 * (F7.2). On success invalidates the detail, the owner list (the summary's
 * name/rating may change) and the analytics stats (a rename doesn't change
 * stats but the invalidate is cheap and keeps the overview fresh).
 */
export function useUpdateBusiness(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (body: UpdateBusinessBody) => {
      const result = await apiFetch(`/businesses/${businessId}`, businessDetailSchema, {
        method: 'PATCH',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['businesses'] });
      },
    },
  );
}
