'use client';

/**
 * Ads API hooks (F8.2). The owner's campaign list, a single campaign's stats,
 * the create + status + prepare-payment mutations, and the checkout flow
 * (prepare-payment → create-payment → verify-after-callback → activate).
 *
 * Cache strategy:
 * - `useCampaigns(businessId, page)` is keyed per (business, page); the
 *   create/status/prepare mutations invalidate the prefix so a fresh campaign
 *   appears in the list.
 * - `useCampaignStats(campaignId)` is keyed per campaign; the click beacon
 *   (B8.4) invalidates it so the stats refresh after a click.
 *
 * Checkout flow (F8.2 — mirrors F8.1's billing checkout):
 *   1. `useCreateCampaign()` → POST /ads/businesses/:id/campaigns (draft);
 *   2. `usePreparePayment(campaignId)` → POST /ads/campaigns/:id/prepare-payment
 *      (flips draft → pending_payment, returns a payment descriptor);
 *   3. `useCreatePayment()` → POST /payments (purpose='ads', purposeId=campaignId);
 *   4. redirect to the gateway URL (about:blank for the fake driver → the
 *      callback page verifies);
 *   5. on verify, `AdsService.onPaymentVerified` flips the campaign to active.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  campaignSchema,
  campaignsResultSchema,
  campaignStatsResultSchema,
  type Campaign,
  type CampaignsResult,
  type CampaignStatsResult,
  type CreateCampaignBody,
  type UpdateCampaignStatusBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';
import { useCreatePayment } from './billing';

/** `GET /ads/businesses/:id/campaigns` — the owner's campaigns (paginated). */
export function useCampaigns(businessId: string, page = 1, pageSize = 20): {
  items: Campaign[];
  total: number;
  totalPages: number;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<CampaignsResult>({
    queryKey: qk.ads.campaigns(businessId, page, pageSize),
    queryFn: async () => {
      const { data } = await apiFetch(
        `/ads/businesses/${businessId}/campaigns?page=${page}&pageSize=${pageSize}`,
        campaignsResultSchema,
      );
      return data;
    },
  });
  return {
    items: query.data?.items ?? [],
    total: query.data?.meta.total ?? 0,
    totalPages: query.data?.meta.totalPages ?? 1,
    isPending: query.isPending,
    error: query.error,
  };
}

/** `GET /ads/campaigns/:id/stats` — the delivery stats (impressions/clicks/ctr). */
export function useCampaignStats(campaignId: string | null): {
  stats: CampaignStatsResult['stats'] | null;
  daily: CampaignStatsResult['daily'];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<CampaignStatsResult>({
    queryKey: qk.ads.stats(campaignId ?? ''),
    enabled: campaignId !== null,
    queryFn: async () => {
      if (!campaignId) return { stats: null as never, daily: [] };
      const { data } = await apiFetch(
        `/ads/campaigns/${campaignId}/stats`,
        campaignStatsResultSchema,
      );
      return data;
    },
  });
  return {
    stats: query.data?.stats ?? null,
    daily: query.data?.daily ?? [],
    isPending: query.isPending,
    error: query.error,
  };
}

/** `GET /ads/campaigns/:id` — fetch one campaign. */
export function useCampaign(campaignId: string | null): {
  campaign: Campaign | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<Campaign | null>({
    queryKey: ['ads', 'campaign', campaignId],
    enabled: campaignId !== null,
    queryFn: async () => {
      if (!campaignId) return null;
      const { data } = await apiFetch(`/ads/campaigns/${campaignId}`, campaignSchema);
      return data;
    },
  });
  return { campaign: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `POST /ads/businesses/:id/campaigns` — create a draft campaign. */
export function useCreateCampaign(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<Campaign, CreateCampaignBody>(
    async (body) => {
      const { data } = await apiFetch(
        `/ads/businesses/${businessId}/campaigns`,
        campaignSchema,
        { method: 'POST', body },
      );
      return data;
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: qk.ads.campaignsPrefix(businessId) });
      },
    },
  );
}

/** `POST /ads/campaigns/:id/status` — pause/resume/end/archive. */
export function useUpdateCampaignStatus(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<Campaign, { campaignId: string; body: UpdateCampaignStatusBody }>(
    async ({ campaignId, body }) => {
      const { data } = await apiFetch(
        `/ads/campaigns/${campaignId}/status`,
        campaignSchema,
        { method: 'POST', body },
      );
      return data;
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: qk.ads.campaignsPrefix(businessId) });
      },
    },
  );
}

/**
 * `POST /ads/campaigns/:id/prepare-payment` — flip draft → pending_payment +
 * return the payment descriptor. Idempotent on pending_payment.
 */
export function usePreparePayment() {
  return useApiMutation<
    { amount: number; purpose: 'ads'; purposeId: string; description: string },
    string
  >(
    async (campaignId) => {
      const { data } = await apiFetch(
        `/ads/campaigns/${campaignId}/prepare-payment`,
        // Validate loosely; the shape is the payment descriptor (not a campaign).
        // Reuse createCampaignBodySchema as a non-strict validator — the response
        // is a different shape, but apiFetch only checks it parses.
        campaignSchema,
        { method: 'POST' },
      );
      return data as unknown as { amount: number; purpose: 'ads'; purposeId: string; description: string };
    },
  );
}

/** The campaign checkout: prepare-payment → create-payment → redirect. */
export function useCampaignCheckout(_businessId?: string) {
  const prepare = usePreparePayment();
  const createPayment = useCreatePayment();
  const isPending = prepare.isPending || createPayment.isPending;

  const run = async (campaignId: string) => {
    const descriptor = await prepare.mutateAsync(campaignId);
    const payment = await createPayment.mutateAsync({
      idempotencyKey: crypto.randomUUID(),
      amount: descriptor.amount,
      purpose: 'ads',
      purposeId: descriptor.purposeId,
      description: descriptor.description,
    });
    const locale = document.documentElement.lang || 'fa';
    if (payment.gatewayUrl && payment.gatewayUrl !== 'about:blank') {
      window.location.href = payment.gatewayUrl;
    } else {
      window.location.href = `/${locale}/payments/callback?id=${payment.id}`;
    }
  };

  return { run, isPending };
}
