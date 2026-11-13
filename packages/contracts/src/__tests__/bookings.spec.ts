import { describe, expect, it } from 'vitest';
import {
  availabilityQuerySchema,
  bookingDateSchema,
  bookingDecisionBodySchema,
  bookingSlotSchema,
  bookingStatusSchema,
  bookingTimeSchema,
  createBookingBodySchema,
  createBookingClosedDayBodySchema,
  createBookingServiceBodySchema,
  myBookingsQuerySchema,
  updateBookingServiceBodySchema,
} from '../bookings.js';
import { iranMobileSchema } from '../primitives.js';

/**
 * B6.1 contracts — the booking shapes. The zod layer is the first gate
 * every payload passes (the DB checks mirror them), so the tests pin the
 * exact accepted/rejected alphabets: local `YYYY-MM-DD` + `HH:mm` (never
 * ISO-with-offset), the strict body objects, and the status vocabulary.
 */

describe('booking primitives (B6.1)', () => {
  it('accepts business-local dates and rejects garbage', () => {
    expect(bookingDateSchema.safeParse('2026-11-13').success).toBe(true);
    expect(bookingDateSchema.safeParse('2026-2-3').success).toBe(false);
    expect(bookingDateSchema.safeParse('2026-11-13T00:00:00Z').success).toBe(false);
    expect(bookingDateSchema.safeParse('not-a-date').success).toBe(false);
  });

  it('accepts HH:mm and rejects seconds/offsets/25:00', () => {
    expect(bookingTimeSchema.safeParse('00:00').success).toBe(true);
    expect(bookingTimeSchema.safeParse('23:59').success).toBe(true);
    expect(bookingTimeSchema.safeParse('24:00').success).toBe(false);
    expect(bookingTimeSchema.safeParse('9:30').success).toBe(false);
    expect(bookingTimeSchema.safeParse('09:30:00').success).toBe(false);
  });
});

describe('createBookingServiceBodySchema (B6.1)', () => {
  it('applies the documented defaults', () => {
    const body = createBookingServiceBodySchema.parse({ name: 'میز دوتنفره' });
    expect(body).toMatchObject({
      durationMinutes: 60,
      slotStepMinutes: 30,
      capacity: 1,
      minPartySize: 1,
      maxPartySize: 10,
      minLeadMinutes: 60,
      cancelWindowMinutes: 120,
      maxAdvanceDays: 30,
      isActive: true,
      sortOrder: 0,
    });
    expect(body.description).toBeUndefined();
  });

  it('rejects out-of-range rules and unknown keys', () => {
    const base = { name: 'میز' };
    expect(createBookingServiceBodySchema.safeParse({ ...base, durationMinutes: 10 }).success).toBe(
      false,
    );
    expect(
      createBookingServiceBodySchema.safeParse({ ...base, durationMinutes: 721 }).success,
    ).toBe(false);
    expect(createBookingServiceBodySchema.safeParse({ ...base, slotStepMinutes: 3 }).success).toBe(
      false,
    );
    expect(createBookingServiceBodySchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(
      createBookingServiceBodySchema.safeParse({ ...base, minPartySize: 4, maxPartySize: 2 })
        .success,
    ).toBe(false);
    expect(createBookingServiceBodySchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('updateBookingServiceBodySchema (B6.1)', () => {
  it('accepts a single-field patch and rejects an empty one', () => {
    expect(updateBookingServiceBodySchema.safeParse({ capacity: 4 }).success).toBe(true);
    expect(updateBookingServiceBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('createBookingBodySchema (B6.1)', () => {
  const valid = {
    businessId: '11111111-1111-4111-8111-111111111111',
    serviceId: '22222222-2222-4222-8222-222222222222',
    date: '2026-11-20',
    startTime: '19:30',
    partySize: 2,
  };

  it('accepts the minimal user body', () => {
    const body = createBookingBodySchema.parse(valid);
    expect(body.contactName).toBeUndefined();
    expect(body.note).toBeUndefined();
  });

  it('normalizes the contact phone to E.164 through iranMobileSchema', () => {
    const body = createBookingBodySchema.parse({
      ...valid,
      contactName: 'امیر',
      contactPhone: '۰۹۱۲۳۴۵۶۷۸۹',
    });
    expect(body.contactPhone).toBe('+989123456789');
  });

  it('rejects non-local dates, bad times and unknown keys', () => {
    expect(createBookingBodySchema.safeParse({ ...valid, date: '2026/11/20' }).success).toBe(false);
    expect(createBookingBodySchema.safeParse({ ...valid, startTime: '19' }).success).toBe(false);
    expect(createBookingBodySchema.safeParse({ ...valid, partySize: 0 }).success).toBe(false);
    expect(createBookingBodySchema.safeParse({ ...valid, userId: 'x' }).success).toBe(false);
  });
});

describe('availability + closed-day bodies (B6.1)', () => {
  it('availability query is strict serviceId+date', () => {
    expect(
      availabilityQuerySchema.safeParse({
        serviceId: '22222222-2222-4222-8222-222222222222',
        date: '2026-11-20',
      }).success,
    ).toBe(true);
    expect(
      availabilityQuerySchema.safeParse({ serviceId: 'nope', date: '2026-11-20' }).success,
    ).toBe(false);
  });

  it('closed-day body takes date + optional note', () => {
    expect(createBookingClosedDayBodySchema.safeParse({ date: '2026-11-20' }).success).toBe(true);
    expect(
      createBookingClosedDayBodySchema.safeParse({ date: '2026-11-20', note: 'جشن خصوصی' }).success,
    ).toBe(true);
    expect(createBookingClosedDayBodySchema.safeParse({ date: 'bad' }).success).toBe(false);
  });

  it('slot shape carries start + available only', () => {
    expect(bookingSlotSchema.safeParse({ start: '19:30', available: true }).success).toBe(true);
    expect(
      bookingSlotSchema.safeParse({ start: '19:30', available: true, remaining: 2 }).success,
    ).toBe(false);
  });
});

describe('status + query schemas (B6.1)', () => {
  it('covers the six-status lifecycle vocabulary', () => {
    for (const status of [
      'pending',
      'confirmed',
      'rejected',
      'cancelled',
      'no_show',
      'completed',
    ] as const) {
      expect(bookingStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(bookingStatusSchema.safeParse('accepted').success).toBe(false);
  });

  it('my-bookings query filters by status and scope with defaults', () => {
    expect(myBookingsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, scope: 'all' });
    expect(myBookingsQuerySchema.safeParse({ scope: 'nope' }).success).toBe(false);
  });

  it('decision body takes confirm/reject + optional reason', () => {
    expect(bookingDecisionBodySchema.safeParse({ action: 'confirm' }).success).toBe(true);
    expect(
      bookingDecisionBodySchema.safeParse({ action: 'reject', reason: 'ظرفیت پر است' }).success,
    ).toBe(true);
    expect(bookingDecisionBodySchema.safeParse({ action: 'cancel' }).success).toBe(false);
    expect(
      bookingDecisionBodySchema.safeParse({ action: 'reject', reason: 'x'.repeat(301) }).success,
    ).toBe(false);
  });
});

describe('iranMobileSchema reuse (B6.1)', () => {
  it('still normalizes latin digits to E.164', () => {
    expect(iranMobileSchema.parse('0912 345 6789')).toBe('+989123456789');
  });
});
