'use client';

/**
 * Owner dashboard Q&A API hooks (F7.4). The owner's Q&A console reads the
 * business's approved questions (`GET /businesses/:id/questions` — paginated)
 * and writes the ONE owner answer per question
 * (`PUT /questions/:id/answer` upsert, `DELETE /questions/:id/answer` idempotent).
 *
 * Authorization notes (B4.8):
 *  - The list returns APPROVED questions only. The `status` filter is a
 *    moderation view gated behind `reviews.manage` — not the owner. The
 *    owner dashboard answers questions, it does not moderate them.
 *  - `upsertAnswer`/`removeAnswer` enforce business ownership on the API.
 *
 * Cache strategy mirrors dashboard-reviews: a per-business question list key
 * (page-aware) is invalidated on every answer write, plus the business detail
 * (the public business page renders the answer).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteQaAnswerResultSchema,
  qaListResultSchema,
  upsertQaAnswerResultSchema,
  type DeleteQaAnswerResult,
  type QaListResult,
  type UpsertQaAnswerBody,
  type UpsertQaAnswerResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** `GET /businesses/:id/questions?page=&pageSize=` — approved questions, newest first. */
export function useBusinessQuestions(
  businessId: string | null | undefined,
  page: number,
  pageSize: number,
): { result: QaListResult | null; isPending: boolean; error: unknown } {
  const query = useQuery<QaListResult>({
    queryKey: qk.dashboard.qa(businessId ?? '', page, pageSize),
    queryFn: async () => {
      const result = await apiFetch(
        `/businesses/${businessId as string}/questions`,
        qaListResultSchema,
        { query: { page, pageSize } },
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `PUT /questions/:id/answer` — create or edit the single owner answer. */
export function useUpsertQaAnswer(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async ({ questionId, body }: { questionId: string; body: UpsertQaAnswerBody }) => {
      const result = await apiFetch(`/questions/${questionId}/answer`, upsertQaAnswerResultSchema, {
        method: 'PUT',
        body,
      });
      return result.data as UpsertQaAnswerResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.qaPrefix(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}

/** `DELETE /questions/:id/answer` — remove the owner answer (idempotent). */
export function useRemoveQaAnswer(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (questionId: string) => {
      const result = await apiFetch(`/questions/${questionId}/answer`, deleteQaAnswerResultSchema, {
        method: 'DELETE',
      });
      return result.data as DeleteQaAnswerResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.qaPrefix(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}
