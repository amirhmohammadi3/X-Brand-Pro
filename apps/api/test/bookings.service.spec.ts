import { describe, expect, it } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BookingsService,
  addDays,
  dbTime,
  generateSlots,
  minutesOf,
  type SlotWindow,
} from '../src/modules/bookings/bookings.service.js';
import type {
  BookingsRepositoryLike,
  BookingServiceContext,
  BookingDetailRow,
  CreateBookingOutcome,
  ReminderCandidate,
} from '../src/modules/bookings/bookings.repository.js';
import type { BookingRow } from '../src/db/schema/bookings.js';
import type { Booking, CreateBookingBody } from '@app/contracts';

/**
 * B6.2 BookingsService — the availability engine and the conflict-free
 * create, DB-free. The pure `generateSlots` grid rules (window fitting,
 * capacity, lead cutoff, overlap dedup) are pinned exactly; the service
 * rules (404-never-leak, closed days, horizon, grid alignment, party
 * bounds, the anti-spam cap, slot_full → 409, code-conflict retry, the
 * created event) run against a fake repository.
 */

const USER = '22222222-2222-4222-8222-222222222222';
const BIZ = '11111111-1111-4111-8111-111111111111';
const SVC = '33333333-3333-4333-8333-333333333333';

function serviceContext(
  overrides: Partial<BookingServiceContext['service']> = {},
): BookingServiceContext {
  return {
    service: {
      id: SVC,
      businessId: BIZ,
      name: 'میز دوتنفره',
      description: null,
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
      ...overrides,
    },
    business: {
      ownerId: null,
      status: 'active',
      deletedAt: null,
      timezone: 'Asia/Tehran',
      name: 'کافه نمونه',
      slug: 'cafe-nemune',
    },
  };
}

/** A realistic future business-local date (never trips past/horizon gates). */
function futureDate(daysAhead = 7): string {
  const now = new Date(Date.now() + 3.5 * 3600_000); // Tehran wall clock
  const iso = now.toISOString().slice(0, 10);
  return addDays(iso, daysAhead);
}

function bookingRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    businessId: BIZ,
    serviceId: SVC,
    userId: USER,
    date: futureDate(),
    startTime: '19:00:00',
    endTime: '20:00:00',
    partySize: 2,
    status: 'pending',
    contactName: null,
    contactPhone: null,
    note: null,
    code: 'ABCD2345',
    confirmedAt: null,
    rejectedAt: null,
    completedAt: null,
    noShowAt: null,
    cancelledAt: null,
    cancelActor: null,
    cancelReason: null,
    reminderSentAt: null,
    createdAt: new Date('2026-11-12T10:00:00Z'),
    updatedAt: new Date('2026-11-12T10:00:00Z'),
    ...overrides,
  };
}

function bookingDetail(overrides: Partial<BookingRow> = {}): BookingDetailRow {
  return {
    ...bookingRow(overrides),
    serviceName: 'میز دوتنفره',
    businessName: 'کافه نمونه',
    businessSlug: 'cafe-nemune',
    businessOwnerId: OWNER,
    businessStatus: 'active',
    timezone: 'Asia/Tehran',
    cancelWindowMinutes: 120,
  };
}

type RepoStub = BookingsRepositoryLike & {
  createCalls: Array<{ code: string; startTime: string; capacity: number }>;
  transitionCalls: Array<{ id: string; from: string[]; to: string }>;
  transitionResult: BookingDetailRow | null;
  reminderCandidates: ReminderCandidate[];
  stampedReminderIds: string[];
};

const OWNER = '55555555-5555-4555-8555-555555555555';

function makeRepo(
  ctx: BookingServiceContext | null,
  overrides: Partial<BookingsRepositoryLike> = {},
  createOutcome: (attempt: number) => CreateBookingOutcome = () => ({
    ok: true,
    row: bookingRow(),
  }),
): RepoStub {
  let attempts = 0;
  const repo: RepoStub = {
    createCalls: [],
    transitionCalls: [],
    transitionResult: null,
    reminderCandidates: [],
    stampedReminderIds: [],
    async findServiceContext() {
      return ctx;
    },
    async findClosedDay() {
      return null;
    },
    async findWeekly() {
      // All-day, every weekday — any future date has bookable windows.
      return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, allDay: true as const }));
    },
    async findSpecialDaysInRange() {
      return [];
    },
    async countActiveByStart() {
      return {};
    },
    async countUserActiveForBusiness() {
      return 0;
    },
    async createBookingTx(input: Parameters<BookingsRepositoryLike['createBookingTx']>[0]) {
      attempts += 1;
      repo.createCalls.push({
        code: input.code,
        startTime: input.startTime,
        capacity: input.capacity,
      });
      const outcome = createOutcome(attempts);
      if (outcome.ok) {
        return {
          ok: true,
          row: bookingRow({
            ...outcome.row,
            code: input.code,
            startTime: input.startTime,
            endTime: input.endTime,
            date: input.date,
          }),
        };
      }
      return outcome;
    },
    async findBookingDetail() {
      return repo.transitionResult;
    },
    async transitionStatus(
      id: string,
      from: string[],
      patch: Parameters<BookingsRepositoryLike['transitionStatus']>[2],
    ) {
      repo.transitionCalls.push({ id, from, to: patch.status });
      return repo.transitionResult;
    },
    async findReminderCandidates() {
      return repo.reminderCandidates;
    },
    async stampReminderSent(ids: string[]) {
      repo.stampedReminderIds.push(...ids);
    },
    async listUserBookings() {
      return { rows: [], total: 0 };
    },
    ...overrides,
  } as unknown as RepoStub;
  return repo;
}

function makeService(repo: BookingsRepositoryLike) {
  const events: Array<{ name: string; payload: unknown }> = [];
  const emitter = {
    emit(name: string, payload: unknown) {
      events.push({ name, payload });
    },
  } as unknown as EventEmitter2;
  const service = new BookingsService(repo, emitter);
  return { service, events };
}

function createBody(overrides: Partial<CreateBookingBody> = {}): CreateBookingBody {
  return {
    businessId: BIZ,
    serviceId: SVC,
    date: futureDate(),
    startTime: '19:00',
    partySize: 2,
    ...overrides,
  };
}

// ─── pure engine ─────────────────────────────────────────────────────────────

describe('generateSlots — B6.2 engine', () => {
  const base = {
    durationMinutes: 60,
    slotStepMinutes: 30,
    counts: {},
    capacity: 1,
    minStartInstantMs: 0,
    startInstantMs: (m: number) => m * 60_000,
  };

  it('snaps to the grid and fits the window', () => {
    const windows: SlotWindow[] = [{ openMin: minutesOf('18:00'), closeMin: minutesOf('20:00') }];
    const slots = generateSlots({ ...base, windows });
    expect(slots.map((s) => s.start)).toEqual(['18:00', '18:30', '19:00']);
    // 19:30 + 60 > 20:00 → excluded.
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('marks full slots unavailable (counts per HH:mm:ss)', () => {
    const windows: SlotWindow[] = [{ openMin: 0, closeMin: 120 }];
    const slots = generateSlots({ ...base, windows, counts: { [dbTime(30)]: 1 } });
    expect(slots).toEqual([
      { start: '00:00', available: true },
      { start: '00:30', available: false },
      { start: '01:00', available: true },
    ]);
  });

  it('respects the lead cutoff against real instants', () => {
    const windows: SlotWindow[] = [{ openMin: 0, closeMin: 240 }];
    const slots = generateSlots({
      ...base,
      windows,
      minStartInstantMs: 150 * 60_000,
    });
    // Starts 0..180; the cutoff (150) leaves 02:30 and 03:00 available.
    expect(slots.filter((s) => s.available).map((s) => s.start)).toEqual(['02:30', '03:00']);
    expect(slots[0]?.available).toBe(false);
  });

  it('dedups overlapping windows (tail + own interval)', () => {
    const windows: SlotWindow[] = [
      { openMin: 0, closeMin: 120 },
      { openMin: 0, closeMin: 60 },
    ];
    const slots = generateSlots({ ...base, windows });
    expect(slots.map((s) => s.start)).toEqual(['00:00', '00:30', '01:00']);
  });

  it('sorts slots ascending across windows', () => {
    const windows: SlotWindow[] = [
      { openMin: 180, closeMin: 300 },
      { openMin: 0, closeMin: 120 },
    ];
    const slots = generateSlots({ ...base, windows });
    expect(slots.map((s) => s.start)).toEqual([
      '00:00',
      '00:30',
      '01:00',
      '03:00',
      '03:30',
      '04:00',
    ]);
  });
});

describe('availability — B6.2', () => {
  it('serves grid slots from the weekly schedule with lead filtering', async () => {
    const ctx = serviceContext({ minLeadMinutes: 0 });
    const date = futureDate(3);
    const repo = makeRepo(ctx);
    const { service } = makeService(repo);
    const result = await service.availability(SVC, date);
    expect(result.closed).toBe(false);
    // all-day Monday → (1440−60)/30 + 1 = 47 grid starts on a 30-min grid
    // with a 60-min duration; the last one ends exactly at 24:00.
    expect(result.slots.length).toBe(47);
    expect(result.slots[0]).toEqual({ start: '00:00', available: true });
    expect(result.slots[46]).toEqual({ start: '23:00', available: true });
  });

  it('answers 404 for a missing/inactive service or non-active business', async () => {
    const { service } = makeService(makeRepo(null));
    await expect(service.availability(SVC, futureDate())).rejects.toMatchObject({ status: 404 });

    const inactiveBiz = makeRepo(serviceContext(), {
      async findServiceContext() {
        const ctx = serviceContext();
        ctx.business.status = 'suspended';
        return ctx;
      },
    });
    await expect(
      makeService(inactiveBiz).service.availability(SVC, futureDate()),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('closed day → closed: true with no slots', async () => {
    const repo = makeRepo(serviceContext(), {
      async findClosedDay() {
        return { note: 'جشن خصوصی' };
      },
    });
    const result = await makeService(repo).service.availability(SVC, futureDate());
    expect(result).toEqual({ serviceId: SVC, date: expect.any(String), closed: true, slots: [] });
  });

  it('past dates and horizon overflow answer closed: true', async () => {
    const { service } = makeService(makeRepo(serviceContext({ maxAdvanceDays: 14 })));
    const past = await service.availability(SVC, addDays(futureDate(0), -2));
    expect(past.closed).toBe(true);
    const beyond = await service.availability(SVC, futureDate(20));
    expect(beyond.closed).toBe(true);
  });

  it('a closed special day closes the date even with weekly hours', async () => {
    const date = futureDate(3);
    const repo = makeRepo(serviceContext(), {
      async findSpecialDaysInRange(_biz, from, to) {
        if (from <= date && date <= to) return [{ date, closed: true, intervals: undefined }];
        return [];
      },
    });
    const result = await makeService(repo).service.availability(SVC, date);
    expect(result.closed).toBe(true);
    expect(result.slots).toEqual([]);
  });

  it('counts make only the taken slots unavailable', async () => {
    const ctx = serviceContext({ capacity: 2, minLeadMinutes: 0 });
    const repo = makeRepo(ctx, {
      async countActiveByStart() {
        return { [dbTime(minutesOf('18:00'))]: 2 };
      },
    });
    const date = futureDate(3);
    const result = await makeService(repo).service.availability(SVC, date);
    const taken = result.slots.find((s) => s.start === '18:00');
    const open = result.slots.find((s) => s.start === '18:30');
    expect(taken).toEqual({ start: '18:00', available: false });
    expect(open).toEqual({ start: '18:30', available: true });
  });
});

describe('create — B6.2', () => {
  it('creates the booking, emits the event, and passes capacity + grid time', async () => {
    const repo = makeRepo(serviceContext());
    const { service, events } = makeService(repo);
    const body = createBody();
    const result = await service.create(USER, body);
    expect(result.status).toBe('pending');
    expect(result.startTime).toBe('19:00:00');
    expect(result.endTime).toBe('20:00:00');
    expect(result.serviceName).toBe('میز دوتنفره');
    expect(result.businessSlug).toBe('cafe-nemune');
    expect(repo.createCalls).toHaveLength(1);
    expect(repo.createCalls[0]?.capacity).toBe(1);
    expect(repo.createCalls[0]?.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('booking.created');
    expect(events[0]?.payload).toMatchObject({ userId: USER, businessId: BIZ, partySize: 2 });
  });

  it('422s the party bounds, grid misalignment, closed day and lead time', async () => {
    const { service } = makeService(makeRepo(serviceContext()));
    await expect(service.create(USER, createBody({ partySize: 11 }))).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.create(USER, createBody({ startTime: '19:10' }))).rejects.toMatchObject({
      status: 422,
    });

    const closedRepo = makeRepo(serviceContext(), {
      async findClosedDay() {
        return { note: null };
      },
    });
    await expect(makeService(closedRepo).service.create(USER, createBody())).rejects.toMatchObject({
      status: 422,
    });

    // 60-min lead vs a slot ~7 days out passes; a 10-hour lead on the same
    // date still passes (far future), so test lead via a today-ish body:
    const nearDate = futureDate(0);
    const nearRepo = makeRepo(serviceContext({ minLeadMinutes: 12 * 60 }));
    await expect(
      makeService(nearRepo).service.create(
        USER,
        createBody({ date: nearDate, startTime: '00:00' }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('422s a slot that does not fit the opening hours', async () => {
    const date = futureDate(3);
    // Monday 10:00–12:00 special-day windows only.
    const repo = makeRepo(serviceContext(), {
      async findSpecialDaysInRange(_biz, from, to) {
        if (from <= date && date <= to) {
          return [{ date, closed: false, intervals: [{ open: '10:00', close: '12:00' }] }];
        }
        return [];
      },
    });
    await expect(
      makeService(repo).service.create(USER, createBody({ date })),
    ).rejects.toMatchObject({ status: 422 });
    // Inside the window it passes.
    const ok = await makeService(repo).service.create(
      USER,
      createBody({ date, startTime: '10:30' }),
    );
    expect(ok.startTime).toBe('10:30:00');
  });

  it('409s the anti-spam cap (active bookings per business)', async () => {
    const repo = makeRepo(serviceContext(), {
      async countUserActiveForBusiness() {
        return 5;
      },
    });
    await expect(makeService(repo).service.create(USER, createBody())).rejects.toMatchObject({
      status: 409,
    });
  });

  it('409s slot_full without retrying codes', async () => {
    const repo = makeRepo(serviceContext(), {}, () => ({ ok: false, reason: 'slot_full' }));
    const { service } = makeService(repo);
    await expect(service.create(USER, createBody())).rejects.toMatchObject({ status: 409 });
    expect(repo.createCalls).toHaveLength(1);
  });

  it('retries the code on a unique race, then succeeds', async () => {
    const repo = makeRepo(serviceContext(), {}, (attempt) =>
      attempt === 1 ? { ok: false, reason: 'code_conflict' } : { ok: true, row: bookingRow() },
    );
    const { service } = makeService(repo);
    const result = await service.create(USER, createBody());
    expect(result.status).toBe('pending');
    expect(repo.createCalls).toHaveLength(2);
    expect(repo.createCalls[0]?.code).not.toBe(repo.createCalls[1]?.code);
  });
});

describe('listMine — B6.2', () => {
  it('passes the Tehran wall clock to the repo and maps the page', async () => {
    const captured: { v: { today: string; nowTime: string; scope: string } | null } = { v: null };
    const detail: BookingDetailRow = {
      ...bookingRow(),
      serviceName: 'میز دوتنفره',
      businessName: 'کافه نمونه',
      businessSlug: 'cafe-nemune',
      businessOwnerId: null,
      businessStatus: 'active',
      timezone: 'Asia/Tehran',
      cancelWindowMinutes: 120,
    };
    const repo = makeRepo(serviceContext(), {
      async listUserBookings(_userId: string, opts) {
        captured.v = { today: opts.today, nowTime: opts.nowTime, scope: opts.scope };
        return { rows: [detail], total: 1 };
      },
    });
    const { service } = makeService(repo);
    const result = await service.listMine(USER, { page: 2, pageSize: 10, scope: 'upcoming' });
    expect(captured.v).toMatchObject({ scope: 'upcoming' });
    expect(captured.v?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(captured.v?.nowTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(result.meta).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
    const dto = result.bookings[0] as Booking;
    expect(dto.businessName).toBe('کافه نمونه');
    expect(dto.createdAt).toBe(detail.createdAt.toISOString());
    expect(dto.confirmedAt).toBeNull();
  });
});

describe('lifecycle — B6.3', () => {
  const OWNER_ACTOR = { id: OWNER, role: 'user' };
  const STRANGER_ACTOR = { id: '66666666-6666-4666-8666-666666666666', role: 'user' };
  const ADMIN_ACTOR = { id: '77777777-7777-4777-8777-777777777777', role: 'admin' };

  function lifecycleRepo(
    detail: BookingDetailRow,
    transition: BookingDetailRow | null | undefined = undefined,
  ) {
    const transitionCalls: Array<{ id: string; from: string[]; to: string }> = [];
    const repo = makeRepo(serviceContext(), {
      async findBookingDetail() {
        return detail;
      },
      async transitionStatus(_id, _from, patch) {
        transitionCalls.push({ id: _id, from: _from, to: patch.status });
        // The real UPDATE is guarded: it misses when the row's status is
        // not one of the legal `from` statuses.
        if (!_from.includes(detail.status)) return null;
        if (transition === null) return null; // guard miss → 409
        // Default: echo the applied patch onto the row (the happy UPDATE).
        return transition ?? ({ ...detail, ...patch, status: patch.status } as BookingDetailRow);
      },
    });
    return Object.assign(repo, { transitionCalls });
  }

  it('confirm by the owner: pending → confirmed, stamp + event, guarded UPDATE', async () => {
    const detail = bookingDetail({ status: 'pending' });
    const repo = lifecycleRepo(detail);
    const { service, events } = makeService(repo);
    const result = await service.decide(OWNER_ACTOR, detail.id, 'confirm');
    expect(result.status).toBe('confirmed');
    expect(repo.transitionCalls[0]).toMatchObject({
      id: detail.id,
      from: ['pending'],
      to: 'confirmed',
    });
    expect(events[0]?.name).toBe('booking.confirmed');
  });

  it('reject by the owner carries the reason; admin bypasses ownership', async () => {
    const detail = bookingDetail({ status: 'pending' });
    const repo = lifecycleRepo(detail);
    const { service, events } = makeService(repo);
    const result = await service.decide(ADMIN_ACTOR, detail.id, 'reject', 'ظرفیت کامل است');
    expect(result.status).toBe('rejected');
    expect(events[0]?.name).toBe('booking.rejected');
    expect(repo.transitionCalls[0]?.to).toBe('rejected');
  });

  it('403 for a stranger decision; 404 for a missing booking', async () => {
    const detail = bookingDetail({ status: 'pending' });
    const { service } = makeService(lifecycleRepo(detail));
    await expect(service.decide(STRANGER_ACTOR, detail.id, 'confirm')).rejects.toMatchObject({
      status: 403,
    });
    const missingRepo = makeRepo(serviceContext(), {
      async findBookingDetail() {
        return null;
      },
    });
    await expect(
      makeService(missingRepo).service.decide(OWNER_ACTOR, detail.id, 'confirm'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('409 when the guard misses (another actor moved first)', async () => {
    const detail = bookingDetail({ status: 'pending' });
    const repo = lifecycleRepo(detail, null);
    await expect(
      makeService(repo).service.decide(OWNER_ACTOR, detail.id, 'confirm'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('user cancel inside the window → cancelled with actor user', async () => {
    // Start ~7 days out → far inside a 120-min window.
    const detail = bookingDetail({ status: 'confirmed', userId: USER });
    const repo = lifecycleRepo(detail);
    const { service, events } = makeService(repo);
    const result = await service.cancel({ id: USER, role: 'user' }, detail.id, 'plan changed');
    expect(result.status).toBe('cancelled');
    expect(result.cancelActor).toBe('user');
    expect(repo.transitionCalls[0]).toMatchObject({
      from: ['pending', 'confirmed'],
      to: 'cancelled',
    });
    expect(events[0]?.name).toBe('booking.cancelled');
    expect(events[0]?.payload).toMatchObject({ cancelledBy: 'user' });
  });

  it('user cancel inside the window past the policy deadline → 422', async () => {
    // Start in ~60 minutes (Tehran) with a 120-min window → policy refusal.
    const tehranNow = new Date(Date.now() + 3.5 * 3600_000);
    const startWall = new Date(tehranNow.getTime() + 60 * 60_000);
    const date = startWall.toISOString().slice(0, 10);
    const startTime = `${startWall.toISOString().slice(11, 13)}:00:00`;
    const detail = bookingDetail({ status: 'confirmed', userId: USER, date, startTime });
    const { service } = makeService(lifecycleRepo(detail));
    await expect(service.cancel({ id: USER, role: 'user' }, detail.id)).rejects.toMatchObject({
      status: 422,
    });
  });

  it('owner cancel skips the policy window and records actor business', async () => {
    const detail = bookingDetail({ status: 'confirmed', userId: USER });
    const repo = lifecycleRepo(detail);
    const { service, events } = makeService(repo);
    const result = await service.cancel(OWNER_ACTOR, detail.id, 'تعطیلی ناگهانی');
    expect(result.cancelActor).toBe('business');
    expect(events[0]?.payload).toMatchObject({ cancelledBy: 'business' });
  });

  it('a stranger cancel gets the same 404 as a missing booking', async () => {
    const detail = bookingDetail({ status: 'confirmed' });
    const { service } = makeService(lifecycleRepo(detail));
    await expect(service.cancel(STRANGER_ACTOR, detail.id)).rejects.toMatchObject({ status: 404 });
  });

  it('no-show and complete only from confirmed, owner-only', async () => {
    const confirmed = bookingDetail({ status: 'confirmed' });
    const repo = lifecycleRepo(confirmed);
    const { service } = makeService(repo);
    const marked = await service.markNoShow(OWNER_ACTOR, confirmed.id);
    expect(marked.status).toBe('no_show');
    expect(repo.transitionCalls[0]).toMatchObject({ from: ['confirmed'], to: 'no_show' });
    const done = await service.complete(OWNER_ACTOR, confirmed.id);
    expect(done.status).toBe('completed');
    await expect(
      makeService(lifecycleRepo(bookingDetail({ status: 'pending' }))).service.complete(
        OWNER_ACTOR,
        confirmed.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      makeService(lifecycleRepo(confirmed)).service.markNoShow(STRANGER_ACTOR, confirmed.id),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('reminders — B6.3', () => {
  function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
    // Start in 60 minutes (Tehran wall clock) — inside the 120-min lead.
    const startWall = new Date(Date.now() + 3.5 * 3600_000 + 60 * 60_000);
    return {
      id: '88888888-8888-4888-8888-888888888888',
      userId: USER,
      businessId: BIZ,
      date: startWall.toISOString().slice(0, 10),
      startTime: startWall.toISOString().slice(11, 16),
      timezone: 'Asia/Tehran',
      ...overrides,
    };
  }

  it('stamps + emits only the due candidates', async () => {
    const due = candidate();
    const notYet = candidate({
      id: '89898989-8989-4989-8989-898989898989',
      startTime: '23:59',
      date: addDays(candidate().date, 1),
    });
    const past = candidate({
      id: '87878787-8787-4787-8787-878787878787',
      date: addDays(candidate().date, -1),
      startTime: '00:00',
    });
    const repo = makeRepo(serviceContext(), {}, () => ({ ok: true, row: bookingRow() }));
    repo.reminderCandidates = [due, notYet, past];
    const { service, events } = makeService(repo);
    const count = await service.runReminders();
    expect(count).toBe(1);
    expect(repo.stampedReminderIds).toEqual([due.id]);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('booking.reminder');
    expect(events[0]?.payload).toMatchObject({ bookingId: due.id, userId: USER });
  });

  it('returns 0 and emits nothing when nothing is due', async () => {
    const repo = makeRepo(serviceContext(), {}, () => ({ ok: true, row: bookingRow() }));
    repo.reminderCandidates = [];
    const { service, events } = makeService(repo);
    expect(await service.runReminders()).toBe(0);
    expect(events).toHaveLength(0);
    expect(repo.stampedReminderIds).toEqual([]);
  });
});
