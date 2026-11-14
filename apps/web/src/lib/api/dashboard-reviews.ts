'use client';

/**
 * Owner dashboard reviews API hooks (F7.4). The owner's reviews console
 * reads the business's approved reviews (`GET /businesses/:id/reviews` —
 * the public list, paginated) and writes the ONE owner reply per review
 * (`PUT /reviews/:id/reply` upsert, `DELETE /reviews/:id/reply` idempotent).
 *
 * Authorization notes (B4.3):
 *  - The list returns APPROVED reviews only. Pending/rejected are a
 *    moderation view gated behind `reviews.manage` — not the owner. The
 *    owner dashboard is a business reply console, not a moderation queue.
 *  - `upsertReply`/`removeReply` enforce ownership on the API; a 403 here
 *    means the caller no longer owns the business (e.g. ownership transfer).
 *
 * Cache strategy: a per-business list key (page-aware) is invalidated on
 * every reply write so the review's `reply` field flips immediately in the
 * open list. The business detail is also invalidated because the page
 * aggregate carries nothing about replies — but the public business page
 * DOES render the reply, so a reader who navigates there sees it too.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteReviewReplyResultSchema,
  reviewListResultSchema,
  upsertReviewReplyResultSchema,
  type DeleteReviewReplyResult,
  type ReviewListResult,
  type UpsertReviewReplyBody,
  type UpsertReviewReplyResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** `GET /businesses/:id/reviews?page=&pageSize=` — approved reviews, newest first. */
export function useBusinessReviews(
  businessId: string | null | undefined,
  page: number,
  pageSize: number,
): { result: ReviewListResult | null; isPending: boolean; error: unknown } {
  const query = useQuery<ReviewListResult>({
    queryKey: qk.dashboard.reviews(businessId ?? '', page, pageSize),
    queryFn: async () => {
      const result = await apiFetch(
        `/businesses/${businessId as string}/reviews`,
        reviewListResultSchema,
        { query: { page, pageSize } },
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `PUT /reviews/:id/reply` — create or edit the single owner reply. */
export function useUpsertReviewReply(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async ({ reviewId, body }: { reviewId: string; body: UpsertReviewReplyBody }) => {
      const result = await apiFetch(`/reviews/${reviewId}/reply`, upsertReviewReplyResultSchema, {
        method: 'PUT',
        body,
      });
      return result.data as UpsertReviewReplyResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.reviewsPrefix(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}

/** `DELETE /reviews/:id/reply` — remove the owner reply (idempotent). */
export function useRemoveReviewReply(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (reviewId: string) => {
      const result = await apiFetch(`/reviews/${reviewId}/reply`, deleteReviewReplyResultSchema, {
        method: 'DELETE',
      });
      return result.data as DeleteReviewReplyResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.reviewsPrefix(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}
