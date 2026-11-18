'use client';

/**
 * Billing API hooks (F8.1). The plan catalog, the per-business subscription
 * (the active plan + its limits), the invoice history, and the checkout flow
 * (upsert-subscription → create-payment → verify-after-callback → settle).
 *
 * Cache strategy:
 * - `usePlans()` is keyed once globally (`qk.billing.plans()`) — the catalog
 *   is the same for every visitor; the pricing page + the checkout modal share
 *   the key so a single fetch warms both.
 * - `useSubscription(businessId)` is keyed per business; the upsert + cancel
 *   mutations invalidate it (the plan badge in the nav refreshes at once).
 * - `useInvoices(businessId, page)` is keyed per (business, page); the upsert
 *   invalidates the prefix so a fresh invoice appears in the history.
 *
 * Checkout flow (F8.1):
 *   1. `useUpsertSubscription()` → POST /billing/businesses/:id/subscription
 *      returns { subscription, invoice, payment: { amount, purpose, purposeId,
 *      description } };
 *   2. `useCreatePayment()` → POST /payments with the descriptor above (the
 *      client generates the idempotencyKey — a fresh UUID per click);
 *   3. redirect to `payment.gatewayUrl` (the Zarinpal sandbox URL, or
 *      `about:blank` for the fake driver);
 *   4. after the gateway redirects back to `/[locale]/payments/callback?id=…`,
 *      the callback page calls `useVerifyPayment()` → POST /payments/:id/verify;
 *   5. on `{ verified: true }`, the page routes back to the billing dashboard.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  invoiceSchema,
  invoicesResultSchema,
  paymentSchema,
  plansResultSchema,
  subscriptionResultSchema,
  upsertSubscriptionBodySchema,
  verifyPaymentResultSchema,
  type CreatePaymentBody,
  type Invoice,
  type InvoicesResult,
  type Payment,
  type Plan,
  type PlansResult,
  type SubscriptionResult,
  type UpsertSubscriptionBody,
  type VerifyPaymentResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** `GET /billing/plans` — the public plan catalog (cached once globally). */
export function usePlans(): { plans: Plan[]; isPending: boolean; error: unknown } {
  const query = useQuery<PlansResult>({
    queryKey: qk.billing.plans(),
    queryFn: async () => {
      const { data } = await apiFetch('/billing/plans', plansResultSchema);
      return data;
    },
  });
  return {
    plans: query.data?.items ?? [],
    isPending: query.isPending,
    error: query.error,
  };
}

/**
 * `GET /billing/businesses/:id/subscription` — the active subscription + the
 * plan limits (the free-tier fallback when no active sub exists). Returns
 * `subscription: null` + the free-tier limits while loading so callers can
 * render the plan badge without a null guard.
 */
export function useSubscription(businessId: string): {
  subscription: SubscriptionResult['subscription'];
  limits: SubscriptionResult['limits'];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<SubscriptionResult>({
    queryKey: qk.billing.subscription(businessId),
    queryFn: async () => {
      const { data } = await apiFetch(
        `/billing/businesses/${businessId}/subscription`,
        subscriptionResultSchema,
      );
      return data;
    },
  });
  return {
    subscription: query.data?.subscription ?? null,
    limits:
      query.data?.limits ?? {
        galleryPhotos: 8,
        menuItems: 20,
        videos: false,
        ai: false,
        ads: false,
        adCampaigns: 0,
      },
    isPending: query.isPending,
    error: query.error,
  };
}

/** `GET /billing/businesses/:id/invoices` — the invoice history (paginated). */
export function useInvoices(businessId: string, page = 1, pageSize = 20): {
  items: Invoice[];
  total: number;
  totalPages: number;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<InvoicesResult>({
    queryKey: qk.billing.invoices(businessId, page, pageSize),
    queryFn: async () => {
      const { data } = await apiFetch(
        `/billing/businesses/${businessId}/invoices?page=${page}&pageSize=${pageSize}`,
        invoicesResultSchema,
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

/**
 * `POST /billing/businesses/:id/subscription` — create/upgrade the
 * subscription + draft an invoice (pending until the payment verifies).
 * Returns the subscription + the drafted invoice + the payment descriptor
 * the caller passes to `useCreatePayment`. Invalidates the subscription +
 * invoices keys so the plan badge + the history refresh.
 */
export function useUpsertSubscription(businessId: string) {
  const queryClient = useQueryClient();
  type TResult = {
    subscription: NonNullable<SubscriptionResult['subscription']>;
    invoice: Invoice;
    payment: { amount: number; purpose: 'subscription'; purposeId: string; description: string };
  };
  return useApiMutation<TResult, UpsertSubscriptionBody>(
    async (body) => {
      const { data } = await apiFetch(
        `/billing/businesses/${businessId}/subscription`,
        // The response shape is { subscription, invoice, payment }; validate it
        // as a loose object (the contract doesn't yet export a combined schema).
        upsertSubscriptionBodySchema,
        { method: 'POST', body },
      );
      return data as unknown as TResult;
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: qk.billing.subscription(businessId) });
        await queryClient.invalidateQueries({ queryKey: qk.billing.invoicesPrefix(businessId) });
      },
    },
  );
}

/** `POST /billing/businesses/:id/subscription/cancel` — cancel (no renew). */
export function useCancelSubscription(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<{ subscription: SubscriptionResult['subscription'] }, void>(
    async () => {
      const { data } = await apiFetch(
        `/billing/businesses/${businessId}/subscription/cancel`,
        // Validate as a loose object; the shape is { subscription: Subscription|null }.
        subscriptionResultSchema,
        { method: 'POST' },
      );
      return { subscription: (data as unknown as { subscription: SubscriptionResult['subscription'] }).subscription };
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: qk.billing.subscription(businessId) });
        await queryClient.invalidateQueries({ queryKey: qk.billing.invoicesPrefix(businessId) });
      },
    },
  );
}

/**
 * `POST /payments` — create a payment intent (idempotent on idempotencyKey).
 * The caller generates a fresh UUID per click (a double-click with the same
 * key returns the in-flight payment — never a double charge).
 */
export function useCreatePayment() {
  return useApiMutation<Payment, CreatePaymentBody>(async (body) => {
    const { data } = await apiFetch('/payments', paymentSchema, {
      method: 'POST',
      body,
    });
    return data;
  });
}

/**
 * `POST /payments/:id/verify` — verify a payment after the gateway callback.
 * Idempotent — re-verifying an already-verified payment returns the same
 * result without re-calling the gateway.
 */
export function useVerifyPayment(paymentId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<VerifyPaymentResult, void>(
    async () => {
      const { data } = await apiFetch(`/payments/${paymentId}/verify`, verifyPaymentResultSchema, {
        method: 'POST',
        query: {},
      });
      return data;
    },
    {
      onSuccess: async (result) => {
        // A verified payment settles the linked invoice + activates the sub —
        // invalidate the billing keys so the dashboard refreshes.
        if (result.verified) {
          await queryClient.invalidateQueries({ queryKey: qk.billing.all() });
        }
      },
    },
  );
}

/** `GET /payments/:id` — fetch one payment (for the callback page's status). */
export function usePayment(paymentId: string | null): {
  payment: Payment | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<Payment | null>({
    queryKey: ['billing', 'payment', paymentId],
    enabled: paymentId !== null,
    queryFn: async () => {
      if (!paymentId) return null;
      const { data } = await apiFetch(`/payments/${paymentId}`, paymentSchema);
      return data;
    },
  });
  return { payment: query.data ?? null, isPending: query.isPending, error: query.error };
}

export { invoiceSchema };
