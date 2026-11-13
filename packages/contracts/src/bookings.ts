import { z } from 'zod';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { iranMobileSchema, uuidSchema } from './primitives.js';

/**
 * Booking contracts (B6.1). The shapes behind the B6.2 availability
 * engine, the B6.3 lifecycle and the F6.x user flow — one file so the API
 * payload, the web client hooks and the owner panel (F7.5) agree by
 * construction.
 *
 * Design decisions carried from the schema:
 * - **Tables, not seats (v1):** a booking occupies ONE unit of the slot's
 *   `capacity` regardless of `party_size`; party size is only bounds-checked.
 * - **Business-local wall clock:** dates/times are `YYYY-MM-DD` + `HH:mm`
 *   strings in Asia/Tehran local time — the client never sends UTC offsets.
 * - **Status cycle:** pending → confirmed | rejected | cancelled,
 *   confirmed → completed | no_show | cancelled; only `pending` and
 *   `confirmed` consume capacity.
 * - The 404-never-leak rule applies: foreign booking/service ids answer the
 *   same 404 as missing ones (service-level, mirrored by the schemas
 *   accepting bare UUIDs).
 */

// ─── Constants (single source of truth for API, web, tests) ────────────────

export const BOOKING_NAME_MIN = 1;
export const BOOKING_NAME_MAX = 120;
export const BOOKING_DESCRIPTION_MAX = 500;
export const BOOKING_NOTE_MAX = 500;
export const BOOKING_CONTACT_NAME_MAX = 80;
export const BOOKING_CANCEL_REASON_MAX = 300;
export const BOOKING_CLOSED_NOTE_MAX = 200;

/** Slot length bounds (minutes) — mirrors `booking_services_duration_range`. */
export const BOOKING_DURATION_MIN = 15;
export const BOOKING_DURATION_MAX = 720;
/** Grid step bounds (minutes) — mirrors `booking_services_slot_step_range`. */
export const BOOKING_SLOT_STEP_MIN = 5;
export const BOOKING_SLOT_STEP_MAX = 120;
/** Concurrent reservations per slot — mirrors `booking_services_capacity_range`. */
export const BOOKING_CAPACITY_MAX = 200;
/** Party size bounds — mirrors the party checks. */
export const BOOKING_PARTY_MAX = 50;
/** Lead/cancel-window horizon bound (one week, minutes). */
export const BOOKING_POLICY_MINUTES_MAX = 10080;
/** Booking horizon bound (days). */
export const BOOKING_ADVANCE_MAX = 365;

/**
 * Anti-spam cap: open (pending + confirmed) bookings per user, PER
 * BUSINESS. A heavy booker can still hold slots at many businesses; one
 * business cannot be filled by a single account.
 */
export const BOOKING_MAX_ACTIVE_PER_USER_PER_BUSINESS = 5;

/**
 * Rate-limit rules (single source of truth for controller + tests):
 * - availability + my-bookings reads → 60/min per user;
 * - writes (create/transition) → 20/min per user — booking writes are
 *   transactional + locked (B6.2), so the budget is deliberately tighter
 *   than favorites.
 */
export const BOOKING_READ_LIMIT_PER_MIN = 60;
export const BOOKING_WRITE_LIMIT_PER_MIN = 20;

// ─── Enums ──────────────────────────────────────────────────────────────────

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
  'no_show',
  'completed',
] as const;
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const BOOKING_CANCEL_ACTORS = ['user', 'business', 'system'] as const;
export const bookingCancelActorSchema = z.enum(BOOKING_CANCEL_ACTORS);
export type BookingCancelActor = z.infer<typeof bookingCancelActorSchema>;

/** Statuses that consume a slot unit (the B6.2 engine counts these). */
export const BOOKING_ACTIVE_STATUSES = ['pending', 'confirmed'] as const;
export type BookingActiveStatus = (typeof BOOKING_ACTIVE_STATUSES)[number];

/**
 * The lifecycle transition table (B6.3) — the ONLY legal status moves.
 * `pending → confirmed | rejected | cancelled`, `confirmed → completed |
 * no_show | cancelled`; the rest are terminal. The API enforces it with a
 * guarded UPDATE (`WHERE status IN (from)`), so a user-cancel racing an
 * owner-confirm can only ever win once.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  rejected: [],
  cancelled: [],
  completed: [],
  no_show: [],
};

/** How long before the slot the reminder job fires (B6.3 یادآوری). */
export const BOOKING_REMINDER_LEAD_MINUTES = 120;

// ─── Primitives ─────────────────────────────────────────────────────────────

/** Business-local calendar date `YYYY-MM-DD` (shape only; ranges are service logic). */
export const bookingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid date');
export type BookingDate = z.infer<typeof bookingDateSchema>;

/** Local wall clock `HH:mm` (the API expands to `HH:mm:ss` for storage). */
export const bookingTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid time');
export type BookingTime = z.infer<typeof bookingTimeSchema>;

// ─── Booking services (owner panel, F7.5) ───────────────────────────────────

/** One bookable offering as served to owner or public (trimmed public view). */
export const bookingServiceSchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    name: z.string().min(BOOKING_NAME_MIN).max(BOOKING_NAME_MAX),
    description: z.string().max(BOOKING_DESCRIPTION_MAX).nullable(),
    durationMinutes: z.number().int().min(BOOKING_DURATION_MIN).max(BOOKING_DURATION_MAX),
    slotStepMinutes: z.number().int().min(BOOKING_SLOT_STEP_MIN).max(BOOKING_SLOT_STEP_MAX),
    capacity: z.number().int().min(1).max(BOOKING_CAPACITY_MAX),
    minPartySize: z.number().int().min(1).max(BOOKING_PARTY_MAX),
    maxPartySize: z.number().int().min(1).max(BOOKING_PARTY_MAX),
    minLeadMinutes: z.number().int().min(0).max(BOOKING_POLICY_MINUTES_MAX),
    cancelWindowMinutes: z.number().int().min(0).max(BOOKING_POLICY_MINUTES_MAX),
    maxAdvanceDays: z.number().int().min(1).max(BOOKING_ADVANCE_MAX),
    isActive: z.boolean(),
    sortOrder: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type BookingService = z.infer<typeof bookingServiceSchema>;

/** The writable service fields — the base both create and PATCH derive from. */
const bookingServiceBodyObjectSchema = z.object({
  name: z.string().min(BOOKING_NAME_MIN).max(BOOKING_NAME_MAX),
  description: z.string().min(1).max(BOOKING_DESCRIPTION_MAX).optional(),
  durationMinutes: z.number().int().min(BOOKING_DURATION_MIN).max(BOOKING_DURATION_MAX).default(60),
  slotStepMinutes: z
    .number()
    .int()
    .min(BOOKING_SLOT_STEP_MIN)
    .max(BOOKING_SLOT_STEP_MAX)
    .default(30),
  capacity: z.number().int().min(1).max(BOOKING_CAPACITY_MAX).default(1),
  minPartySize: z.number().int().min(1).max(BOOKING_PARTY_MAX).default(1),
  maxPartySize: z.number().int().min(1).max(BOOKING_PARTY_MAX).default(10),
  minLeadMinutes: z.number().int().min(0).max(BOOKING_POLICY_MINUTES_MAX).default(60),
  cancelWindowMinutes: z.number().int().min(0).max(BOOKING_POLICY_MINUTES_MAX).default(120),
  maxAdvanceDays: z.number().int().min(1).max(BOOKING_ADVANCE_MAX).default(30),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const createBookingServiceBodySchema = bookingServiceBodyObjectSchema
  .strict()
  // Mirrors the `booking_services_party_order` DB check.
  .refine((body) => body.minPartySize <= body.maxPartySize, {
    message: 'minPartySize must be <= maxPartySize',
  });
export type CreateBookingServiceBody = z.infer<typeof createBookingServiceBodySchema>;

/** PATCH /bookings/services/:id — every field optional, at least one present. */
export const updateBookingServiceBodySchema = bookingServiceBodyObjectSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'empty update' })
  // Party order only checkable when the patch carries both bounds.
  .refine(
    (body) =>
      body.minPartySize === undefined ||
      body.maxPartySize === undefined ||
      body.minPartySize <= body.maxPartySize,
    { message: 'minPartySize must be <= maxPartySize' },
  );
export type UpdateBookingServiceBody = z.infer<typeof updateBookingServiceBodySchema>;

// ─── Closed days (روزهای تعطیل) ─────────────────────────────────────────────

export const bookingClosedDaySchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    date: bookingDateSchema,
    note: z.string().max(BOOKING_CLOSED_NOTE_MAX).nullable(),
    createdAt: z.string(),
  })
  .strict();
export type BookingClosedDay = z.infer<typeof bookingClosedDaySchema>;

export const createBookingClosedDayBodySchema = z
  .object({
    date: bookingDateSchema,
    note: z.string().min(1).max(BOOKING_CLOSED_NOTE_MAX).optional(),
  })
  .strict();
export type CreateBookingClosedDayBody = z.infer<typeof createBookingClosedDayBodySchema>;

export const bookingClosedDaysResultSchema = z
  .object({ days: z.array(bookingClosedDaySchema) })
  .strict();
export type BookingClosedDaysResult = z.infer<typeof bookingClosedDaysResultSchema>;

// ─── Availability (B6.2) ────────────────────────────────────────────────────

export const availabilityQuerySchema = z
  .object({
    serviceId: uuidSchema,
    date: bookingDateSchema,
  })
  .strict();
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** One slot on the grid: local start + whether it can still be booked. */
export const bookingSlotSchema = z
  .object({
    start: bookingTimeSchema,
    available: z.boolean(),
  })
  .strict();
export type BookingSlot = z.infer<typeof bookingSlotSchema>;

export const availabilityResultSchema = z
  .object({
    serviceId: uuidSchema,
    date: bookingDateSchema,
    /** `true` when the date is a booking closed day or outside the horizon. */
    closed: z.boolean(),
    slots: z.array(bookingSlotSchema),
  })
  .strict();
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;

// ─── Bookings ───────────────────────────────────────────────────────────────

/** POST /bookings — the user flow (F6.1) body. */
export const createBookingBodySchema = z
  .object({
    businessId: uuidSchema,
    serviceId: uuidSchema,
    date: bookingDateSchema,
    startTime: bookingTimeSchema,
    partySize: z.number().int().min(1).max(BOOKING_PARTY_MAX),
    contactName: z.string().min(1).max(BOOKING_CONTACT_NAME_MAX).optional(),
    contactPhone: iranMobileSchema.optional(),
    note: z.string().min(1).max(BOOKING_NOTE_MAX).optional(),
  })
  .strict();
export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;

/** One booking as served to its user or the owner. */
export const bookingSchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    serviceId: uuidSchema,
    userId: uuidSchema,
    date: bookingDateSchema,
    startTime: z.string(),
    endTime: z.string(),
    partySize: z.number().int().min(1),
    status: bookingStatusSchema,
    contactName: z.string().max(BOOKING_CONTACT_NAME_MAX).nullable(),
    contactPhone: z.string().nullable(),
    note: z.string().max(BOOKING_NOTE_MAX).nullable(),
    code: z.string(),
    cancelActor: bookingCancelActorSchema.nullable(),
    cancelReason: z.string().max(BOOKING_CANCEL_REASON_MAX).nullable(),
    confirmedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** Joined for display (owner calendar + my bookings) — may be trimmed by the caller. */
    serviceName: z.string().optional(),
    businessName: z.string().optional(),
    businessSlug: z.string().optional(),
  })
  .strict();
export type Booking = z.infer<typeof bookingSchema>;

/** GET /bookings/me — page-based, newest first, optional status filter. */
export const myBookingsQuerySchema = pageQuerySchema
  .extend({
    status: bookingStatusSchema.optional(),
    /** `upcoming` = date >= today AND status in (pending, confirmed). */
    scope: z.enum(['all', 'upcoming', 'past']).default('all'),
  })
  .strict();
export type MyBookingsQuery = z.infer<typeof myBookingsQuerySchema>;

export const myBookingsResultSchema = z
  .object({ bookings: z.array(bookingSchema), meta: pageMetaSchema })
  .strict();
export type MyBookingsResult = z.infer<typeof myBookingsResultSchema>;

/** GET /bookings/business/:businessId — owner calendar (F7.5). */
export const ownerBookingsQuerySchema = pageQuerySchema
  .extend({
    date: bookingDateSchema.optional(),
    status: bookingStatusSchema.optional(),
  })
  .strict();
export type OwnerBookingsQuery = z.infer<typeof ownerBookingsQuerySchema>;

export const ownerBookingsResultSchema = z
  .object({ bookings: z.array(bookingSchema), meta: pageMetaSchema })
  .strict();
export type OwnerBookingsResult = z.infer<typeof ownerBookingsResultSchema>;

/** POST /bookings — the create result (echoes the code for the confirmation screen). */
export const createBookingResultSchema = z.object({ booking: bookingSchema }).strict();
export type CreateBookingResult = z.infer<typeof createBookingResultSchema>;

/** POST /bookings/:id/confirm | reject | cancel | no-show | complete. */
export const bookingRejectBodySchema = z
  .object({ reason: z.string().min(1).max(BOOKING_CANCEL_REASON_MAX).optional() })
  .strict();
export type BookingRejectBody = z.infer<typeof bookingRejectBodySchema>;

/** POST /bookings/:id/decision — owner confirm/reject in one endpoint. */
export const bookingDecisionBodySchema = z
  .object({
    action: z.enum(['confirm', 'reject']),
    reason: z.string().min(1).max(BOOKING_CANCEL_REASON_MAX).optional(),
  })
  .strict();
export type BookingDecisionBody = z.infer<typeof bookingDecisionBodySchema>;

/** PATCH result for transitions. */
export const bookingStatusResultSchema = z.object({ booking: bookingSchema }).strict();
export type BookingStatusResult = z.infer<typeof bookingStatusResultSchema>;

// ─── Domain events (B6.3 wires these to notify()) ───────────────────────────

export const BOOKING_EVENTS = {
  created: 'booking.created',
  confirmed: 'booking.confirmed',
  rejected: 'booking.rejected',
  cancelled: 'booking.cancelled',
  noShow: 'booking.no_show',
  completed: 'booking.completed',
  /** Fired by the reminder job for each due booking (notify wiring later). */
  reminder: 'booking.reminder',
} as const;
