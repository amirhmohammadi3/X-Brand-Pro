'use client';

/**
 * Business hours API hooks (F7.2). The owner dashboard's hours editor reads
 * the weekly schedule + special days (`GET /businesses/:id/hours`) and
 * replaces the weekly schedule (`PUT /businesses/:id/hours`). Every JSON call
 * goes through the shared `apiFetch` (envelope-validated with the B2.5
 * contracts) and TanStack Query.
 *
 * Cache strategy: `useBusinessHours(id)` is keyed per business; a
 * `replaceWeekly` success invalidates the hours key AND the business detail
 * (the `openStatus` on the detail's page aggregate depends on the schedule).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hoursResponseSchema,
  replaceWeeklyHoursBodySchema,
  type HoursResponse,
  type ReplaceWeeklyHoursBody,
  type WeeklyHours,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** `GET /businesses/:id/hours` — weekly schedule + special days + open status. */
export function useBusinessHours(businessId: string | null | undefined): {
  hours: HoursResponse | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<HoursResponse>({
    queryKey: qk.businesses.hours(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch(
        `/businesses/${businessId as string}/hours`,
        hoursResponseSchema,
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { hours: query.data ?? null, isPending: query.isPending, error: query.error };
}

/**
 * `PUT /businesses/:id/hours` — replace the whole weekly schedule. The body
 * is `{ weekly: WeeklyHours }` (up to 7 weekday entries, no duplicates, no
 * overlapping intervals — validated by `weeklyHoursSchema`).
 */
export function useReplaceWeeklyHours(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (weekly: WeeklyHours) => {
      const body: ReplaceWeeklyHoursBody = { weekly };
      const result = await apiFetch(`/businesses/${businessId}/hours`, hoursResponseSchema, {
        method: 'PUT',
        body,
      });
      // Validate the outgoing body shape too (the schema is strict; a drift
      // fails loudly instead of a 400 round-trip).
      void replaceWeeklyHoursBodySchema.parse(body);
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.businesses.hours(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}
