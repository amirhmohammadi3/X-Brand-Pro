'use client';

/**
 * Owner dashboard bookings API hooks (F7.5). Three concerns live here:
 *
 *  - **Booking services** (CRUD): `GET /bookings/services/owner/:id`,
 *    `POST /bookings/services/:id`, `POST /bookings/services/:id` (PATCH
 *    emulation — the controller reuses the same path for update), `DELETE
 *    /bookings/services/:id`. The list returns every service (active or
 *    not) so the owner can hide an offering without losing its history.
 *  - **Closed days** (روزهای تعطیل): `GET /bookings/closed-days/:id`,
 *    `POST /bookings/closed-days/:id`, `DELETE /bookings/closed-days/:id/:date`.
 *    Distinct from `business_special_days` (working hours): the owner keeps
 *    the café open but stops taking reservations for a private event.
 *  - **Owner calendar**: `GET /bookings/business/:id` paginates the
 *    business's bookings (optional date + status filter). Lifecycle writes
 *    (confirm/reject/no-show/complete) reuse the existing F6.2 hooks and
 *    invalidate the calendar so the row's status flips in place.
 *
 * Cache strategy: every write invalidates the matching list + the business
 * detail (the calendar grid and overview cards both reflect status changes).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bookingClosedDaysResultSchema,
  bookingStatusResultSchema,
  createBookingClosedDayResultSchema,
  createBookingServiceResultSchema,
  deleteBookingClosedDayResultSchema,
  ownerBookingServicesResultSchema,
  ownerBookingsResultSchema,
  updateBookingServiceResultSchema,
  type Booking,
  type BookingClosedDay,
  type BookingDecisionBody,
  type BookingRejectBody,
  type BookingService,
  type BookingStatusResult,
  type CreateBookingClosedDayBody,
  type CreateBookingServiceBody,
  type DeleteBookingClosedDayResult,
  type OwnerBookingServicesResult,
  type OwnerBookingsQuery,
  type OwnerBookingsResult,
  type UpdateBookingServiceBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

// ─── Booking services (owner CRUD) ────────────────────────────────────────

/** `GET /bookings/services/owner/:businessId` — every service (incl. inactive). */
export function useOwnerBookingServices(businessId: string | null | undefined): {
  services: BookingService[];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<OwnerBookingServicesResult>({
    queryKey: qk.dashboard.bookingsServices(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch(
        `/bookings/services/owner/${businessId as string}`,
        ownerBookingServicesResultSchema,
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { services: query.data?.services ?? [], isPending: query.isPending, error: query.error };
}

/** `POST /bookings/services/:businessId` — create one bookable service. */
export function useCreateBookingService(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (body: CreateBookingServiceBody) => {
      const result = await apiFetch(
        `/bookings/services/${businessId}`,
        createBookingServiceResultSchema,
        { method: 'POST', body },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.bookingsServices(businessId) });
      },
    },
  );
}

/** `POST /bookings/services/:id` — patch one service's fields (PATCH-emulation). */
export function useUpdateBookingService(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async ({ serviceId, body }: { serviceId: string; body: UpdateBookingServiceBody }) => {
      const result = await apiFetch(
        `/bookings/services/${serviceId}`,
        updateBookingServiceResultSchema,
        { method: 'POST', body },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.bookingsServices(businessId) });
      },
    },
  );
}

/** `DELETE /bookings/services/:id` — remove a service (204 no-content). */
export function useDeleteBookingService(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (serviceId: string) => {
      await apiFetch(`/bookings/services/${serviceId}`, ownerBookingServicesResultSchema, {
        method: 'DELETE',
      });
      return undefined;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.dashboard.bookingsServices(businessId) });
      },
    },
  );
}

// ─── Closed days (روزهای تعطیل) ───────────────────────────────────────────

/** `GET /bookings/closed-days/:businessId` — the business's closures. */
export function useBookingClosedDays(businessId: string | null | undefined): {
  days: BookingClosedDay[];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<{ days: BookingClosedDay[] }>({
    queryKey: qk.dashboard.bookingsClosedDays(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch(
        `/bookings/closed-days/${businessId as string}`,
        bookingClosedDaysResultSchema,
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { days: query.data?.days ?? [], isPending: query.isPending, error: query.error };
}

/** `POST /bookings/closed-days/:businessId` — add a full-day closure. */
export function useCreateBookingClosedDay(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (body: CreateBookingClosedDayBody) => {
      const result = await apiFetch(
        `/bookings/closed-days/${businessId}`,
        createBookingClosedDayResultSchema,
        { method: 'POST', body },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: qk.dashboard.bookingsClosedDays(businessId),
        });
      },
    },
  );
}

/** `DELETE /bookings/closed-days/:businessId/:date` — idempotent removal. */
export function useDeleteBookingClosedDay(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (date: string) => {
      const result = await apiFetch(
        `/bookings/closed-days/${businessId}/${date}`,
        deleteBookingClosedDayResultSchema,
        { method: 'DELETE' },
      );
      return result.data as DeleteBookingClosedDayResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: qk.dashboard.bookingsClosedDays(businessId),
        });
      },
    },
  );
}

// ─── Owner calendar (F7.5) ────────────────────────────────────────────────

/**
 * `GET /bookings/business/:businessId` — one page of the owner calendar,
 * newest first. `date` filters to one calendar day; `status` to a lifecycle
 * state. Both null = all bookings, paginated.
 */
export function useOwnerBookings(
  businessId: string | null | undefined,
  query: OwnerBookingsQuery,
): { result: OwnerBookingsResult | null; isPending: boolean; error: unknown } {
  const q = useQuery<OwnerBookingsResult>({
    queryKey: qk.dashboard.bookingsCalendar(
      businessId ?? '',
      query.date ?? null,
      query.status ?? null,
      query.page,
      query.pageSize,
    ),
    queryFn: async () => {
      const result = await apiFetch(
        `/bookings/business/${businessId as string}`,
        ownerBookingsResultSchema,
        {
          query: {
            page: query.page,
            pageSize: query.pageSize,
            ...(query.date ? { date: query.date } : {}),
            ...(query.status ? { status: query.status } : {}),
          },
        },
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 15_000,
  });
  return { result: q.data ?? null, isPending: q.isPending, error: q.error };
}

// ─── Owner lifecycle writes (F7.5 calendar actions) ───────────────────────
//
// The lifecycle endpoints (`/decision`, `/no-show`, `/complete`) are owner-
// only POSTs that transition a booking's status. Each invalidates the whole
// calendar prefix so every open page (every status filter) reflects the
// change immediately.

/** `POST /bookings/:id/decision` — owner confirm/reject (optional reason). */
export function useDecideBooking(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async ({ bookingId, body }: { bookingId: string; body: BookingDecisionBody }) => {
      const result = await apiFetch(`/bookings/${bookingId}/decision`, bookingStatusResultSchema, {
        method: 'POST',
        body,
      });
      return result.data as BookingStatusResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: qk.dashboard.bookingsCalendarPrefix(businessId),
        });
      },
    },
  );
}

/** `POST /bookings/:id/no-show` — owner marks a confirmed booking no-show. */
export function useMarkBookingNoShow(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (bookingId: string) => {
      const result = await apiFetch(`/bookings/${bookingId}/no-show`, bookingStatusResultSchema, {
        method: 'POST',
        body: {} as BookingRejectBody,
      });
      return result.data as BookingStatusResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: qk.dashboard.bookingsCalendarPrefix(businessId),
        });
      },
    },
  );
}

/** `POST /bookings/:id/complete` — owner closes out a confirmed booking. */
export function useCompleteBooking(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (bookingId: string) => {
      const result = await apiFetch(`/bookings/${bookingId}/complete`, bookingStatusResultSchema, {
        method: 'POST',
        body: {} as BookingRejectBody,
      });
      return result.data as BookingStatusResult;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: qk.dashboard.bookingsCalendarPrefix(businessId),
        });
      },
    },
  );
}

/** A narrowed view of `Booking` the calendar row renders (display fields). */
export type { Booking };
