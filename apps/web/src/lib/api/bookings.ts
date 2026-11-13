'use client';

/**
 * Bookings API hooks (F6.1/F6.2). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B6.x contract schemas) and
 * TanStack Query via `useApiMutation`.
 *
 * Cache strategy:
 * - availability is keyed by (serviceId, date) — a fresh read on every
 *   service/date change, refetched after a create so the just-taken slot
 *   flips to unavailable immediately;
 * - `qk.bookings.mine(scope)` — a create or cancel invalidates both scopes
 *   (upcoming/past partition changes either way);
 * - the feed token is fetched on demand (the copy-link section) and never
 *   cached stale — a tiny query with a 0 staleTime.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  availabilityResultSchema,
  businessServicesResultSchema,
  calendarTokenSchema,
  createBookingBodySchema,
  createBookingResultSchema,
  myBookingsQuerySchema,
  myBookingsResultSchema,
  bookingStatusResultSchema,
  bookingRejectBodySchema,
  BOOKING_FEED_MAX_EVENTS,
  type AvailabilityResult,
  type Booking,
  type BookingStatus,
  type BusinessServicesResult,
  type CalendarToken,
  type CreateBookingBody,
  type CreateBookingResult,
  type MyBookingsQuery,
  type MyBookingsResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

export type BookingScope = 'upcoming' | 'past' | 'all';

/** The business's ACTIVE bookable services (public, F6.1). */
export function useBookingServices(businessId: string | null) {
  return useQuery({
    queryKey: qk.bookings.services(businessId ?? ''),
    enabled: Boolean(businessId),
    queryFn: async (): Promise<BusinessServicesResult> => {
      const result = await apiFetch('/bookings/services', businessServicesResultSchema, {
        query: { businessId: businessId ?? '' },
      });
      return result.data;
    },
    staleTime: 60_000,
  });
}

/** The slot grid for one service-day (public, F6.1). */
export function useAvailability(serviceId: string | null, date: string | null) {
  return useQuery({
    queryKey: qk.bookings.availability(serviceId ?? '', date ?? ''),
    enabled: Boolean(serviceId) && Boolean(date),
    queryFn: async (): Promise<AvailabilityResult> => {
      const result = await apiFetch('/bookings/availability', availabilityResultSchema, {
        query: { serviceId: serviceId ?? '', date: date ?? '' },
      });
      return result.data;
    },
  });
}

/** POST /bookings — the F6.1 create. */
export function useCreateBooking() {
  const client = useQueryClient();
  return useApiMutation(
    async (body: CreateBookingBody): Promise<CreateBookingResult> => {
      const result = await apiFetch('/bookings', createBookingResultSchema, {
        method: 'POST',
        body: createBookingBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: qk.bookings.mine('upcoming') });
        void client.invalidateQueries({ queryKey: qk.bookings.mine('all') });
        void client.invalidateQueries({ queryKey: ['bookings', 'availability'] });
      },
    },
  );
}

/** GET /bookings/me — the «رزروهای من» list (F6.2). */
export function useMyBookings(
  query: Pick<MyBookingsQuery, 'scope' | 'status' | 'page' | 'pageSize'>,
) {
  return useQuery({
    queryKey: qk.bookings.mine(query.scope, query.status, query.page, query.pageSize),
    queryFn: async (): Promise<MyBookingsResult> => {
      const parsed = myBookingsQuerySchema.parse(query);
      const result = await apiFetch('/bookings/me', myBookingsResultSchema, {
        query: {
          scope: parsed.scope,
          status: parsed.status,
          page: parsed.page,
          pageSize: parsed.pageSize,
        },
      });
      return result.data;
    },
  });
}

/** POST /bookings/:id/cancel — the user-side cancel (B6.3 policy window). */
export function useCancelBooking() {
  const client = useQueryClient();
  return useApiMutation(
    async (input: { bookingId: string; reason?: string }): Promise<{ booking: Booking }> => {
      const body = bookingRejectBodySchema.parse({ reason: input.reason });
      const result = await apiFetch(
        `/bookings/${input.bookingId}/cancel`,
        bookingStatusResultSchema,
        {
          method: 'POST',
          body,
        },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: ['bookings', 'mine'] });
      },
    },
  );
}

/** GET /bookings/me/calendar-token — the ICS feed token (B6.4). */
export function useCalendarToken(enabled: boolean) {
  return useQuery({
    queryKey: qk.bookings.calendarToken(),
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<CalendarToken> => {
      const result = await apiFetch('/bookings/me/calendar-token', calendarTokenSchema);
      return result.data;
    },
  });
}

/** The absolute ICS feed URL for the copy-link UI (F6.2). */
export function calendarFeedUrl(userId: string, token: string): string {
  const base = new URL(
    `/bookings/user/${userId}/calendar.ics?token=${encodeURIComponent(token)}`,
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  );
  return base.href;
}

/** Statuses the F6.2 filter chips cover (the lifecycle vocabulary order). */
export const BOOKING_STATUS_FILTERS: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'rejected',
  'no_show',
];

// The contracts constant re-exported for the hint text (200 events cap).
export { BOOKING_FEED_MAX_EVENTS };
