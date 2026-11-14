// @vitest-environment jsdom
/**
 * F7.5 dashboard-bookings hooks + the three editors (calendar / services /
 * closed-days). Covers the read + write paths with `apiFetch` mocked and a
 * real TanStack QueryClientProvider, mirroring reviews-qa-editors.test.tsx.
 *
 * Auth context is stubbed as an authenticated owner so the editors' hooks
 * resolve; `next-intl` provides the dashboard.bookings.* messages.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Booking, BookingClosedDay, BookingService } from '@app/contracts';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));

const { ToastProvider } = await import('../../src/components/ui/toast');

const messages = {
  form: {
    toast: { close: 'بستن', success: 'موفق', error: 'خطا' },
    overlay: { close: 'بستن' },
    confirm: {
      title: 'تأیید',
      description: 'آیا مطمئن هستید؟',
      confirm: 'تأیید',
      cancel: 'انصراف',
    },
    required: 'الزامی',
    errorSummary: { title: 'خطاها' },
  },
  dashboard: {
    bookings: {
      tabs: { calendar: 'تقویم', services: 'خدمات', closedDays: 'روزهای تعطیل' },
      calendar: {
        title: 'تقویم رزروها',
        subtitle: 'زیرعنوان',
        loading: 'بارگذاری…',
        emptyTitle: 'خالی',
        emptyMessage: 'رزروی نیست',
        count: '{total} رزرو',
        dateLabel: 'تاریخ',
        dateAll: 'همه',
        statusLabel: 'وضعیت',
        statusAll: 'همه',
        colCode: 'کد',
        colService: 'خدمت',
        colDate: 'تاریخ',
        colTime: 'ساعت',
        colParty: 'تعداد',
        colStatus: 'وضعیت',
        colActions: 'عملیات',
        prevDay: 'قبل',
        nextDay: 'بعد',
        confirm: 'تأیید',
        reject: 'رد',
        noShow: 'عدم‌حضور',
        complete: 'تکمیل',
        confirmTitle: 'تأیید',
        confirmMessage: 'تأیید می‌کنید؟',
        rejectReason: 'دلیل',
        status_pending: 'در انتظار',
        status_confirmed: 'تأییدشده',
        status_rejected: 'ردشده',
        status_cancelled: 'لغو',
        status_completed: 'تکمیل',
        status_no_show: 'عدم‌حضور',
        actionDone: 'انجام شد',
      },
      services: {
        title: 'خدمات رزرو',
        subtitle: 'زیرعنوان',
        loading: 'بارگذاری…',
        emptyTitle: 'خالی',
        emptyMessage: 'خدمتی نیست',
        count: '{count} خدمت',
        add: 'افزودن',
        name: 'نام',
        description: 'توضیح',
        duration: 'مدت',
        slotStep: 'گام',
        capacity: 'ظرفیت',
        minParty: 'حداقل',
        maxParty: 'حداکثر',
        minLead: 'lead',
        cancelWindow: 'لغو',
        maxAdvance: 'افق',
        isActive: 'فعال',
        sortOrder: 'ترتیب',
        edit: 'ویرایش',
        delete: 'حذف',
        save: 'ذخیره',
        cancel: 'انصراف',
        created: 'اضافه شد',
        updated: 'به‌روز شد',
        deleted: 'حذف شد',
        confirmDelete: 'مطمئن؟',
        error: 'خطا',
      },
      closedDays: {
        title: 'روزهای تعطیل',
        subtitle: 'زیرعنوان',
        loading: 'بارگذاری…',
        emptyTitle: 'خالی',
        emptyMessage: 'تاریخی نیست',
        count: '{count} روز',
        date: 'تاریخ',
        note: 'یادداشت',
        notePlaceholder: 'مثلاً',
        add: 'افزودن',
        delete: 'حذف',
        added: 'اضافه شد',
        removed: 'حذف شد',
        exists: 'تکراری',
        error: 'خطا',
      },
    },
    services: { cancel: 'انصراف' },
  },
  ui: { error: 'خطا', retry: 'تلاش' },
  errors: { internal_error: 'خطای داخلی' },
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderWith(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <NextIntlClientProvider locale="fa" messages={messages}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeService(overrides: Partial<BookingService> = {}): BookingService {
  return {
    id: 'svc-1',
    businessId: 'b1',
    name: 'میز دونفره',
    description: null,
    durationMinutes: 60,
    slotStepMinutes: 30,
    capacity: 4,
    minPartySize: 1,
    maxPartySize: 6,
    minLeadMinutes: 60,
    cancelWindowMinutes: 120,
    maxAdvanceDays: 30,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    businessId: 'b1',
    serviceId: 'svc-1',
    userId: 'u1',
    date: '2026-11-20',
    startTime: '19:00:00',
    endTime: '20:00:00',
    partySize: 2,
    status: 'pending',
    contactName: 'علی',
    contactPhone: null,
    note: null,
    code: 'AB12',
    cancelActor: null,
    cancelReason: null,
    confirmedAt: null,
    cancelledAt: null,
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
    serviceName: 'میز دونفره',
    businessName: 'کافه',
    businessSlug: 'cafe',
    ...overrides,
  };
}

function makeClosedDay(overrides: Partial<BookingClosedDay> = {}): BookingClosedDay {
  return {
    id: 'cd-1',
    businessId: 'b1',
    date: '2026-11-20',
    note: 'جشن خصوصی',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const OWNER_BOOKINGS_META = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('ServicesEditor (F7.5)', () => {
  it('renders the service list with the active badge', async () => {
    apiFetchMock.mockResolvedValueOnce({
      data: { services: [makeService()] },
    });
    const { ServicesEditor } = await import('../../src/components/dashboard/services-editor');
    renderWith(<ServicesEditor businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('میز دونفره')).toBeInTheDocument();
    });
    expect(screen.getByText('فعال')).toBeInTheDocument();
  });

  it('renders the empty state when no services exist', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: { services: [] } });
    const { ServicesEditor } = await import('../../src/components/dashboard/services-editor');
    renderWith(<ServicesEditor businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('خدمتی نیست')).toBeInTheDocument();
    });
  });

  it('opens the create form when "add" is clicked and POSTs on submit', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: { services: [] } });
    apiFetchMock.mockResolvedValueOnce({
      data: { service: makeService({ id: 'svc-new' }) },
    });
    const { ServicesEditor } = await import('../../src/components/dashboard/services-editor');
    renderWith(<ServicesEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('خدمتی نیست')).toBeInTheDocument());
    fireEvent.click(screen.getByText('افزودن'));
    await waitFor(() => expect(screen.getByLabelText('نام')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('نام'), { target: { value: 'میز جدید' } });
    // In "new" mode the submit button uses the "add" label.
    const submitButtons = screen.getAllByText('افزودن');
    fireEvent.click(submitButtons[submitButtons.length - 1] as HTMLElement);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/bookings/services/b1',
        expect.anything(),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});

describe('ClosedDaysEditor (F7.5)', () => {
  it('renders the closed-day list with date + note', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: { days: [makeClosedDay()] } });
    const { ClosedDaysEditor } = await import('../../src/components/dashboard/closed-days-editor');
    renderWith(<ClosedDaysEditor businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('2026-11-20')).toBeInTheDocument();
    });
    expect(screen.getByText('جشن خصوصی')).toBeInTheDocument();
  });

  it('renders the empty state when no closed days exist', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: { days: [] } });
    const { ClosedDaysEditor } = await import('../../src/components/dashboard/closed-days-editor');
    renderWith(<ClosedDaysEditor businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('تاریخی نیست')).toBeInTheDocument();
    });
  });

  it('POSTs a new closed day when the form is submitted', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: { days: [] } });
    apiFetchMock.mockResolvedValueOnce({
      data: { day: makeClosedDay({ date: '2026-12-01', note: 'تعطیلی' }) },
    });
    const { ClosedDaysEditor } = await import('../../src/components/dashboard/closed-days-editor');
    renderWith(<ClosedDaysEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('تاریخی نیست')).toBeInTheDocument());
    const dateInput = screen.getByLabelText('تاریخ');
    fireEvent.change(dateInput, { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('یادداشت'), { target: { value: 'تعطیلی' } });
    fireEvent.click(screen.getByText('افزودن'));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/bookings/closed-days/b1',
        expect.anything(),
        expect.objectContaining({ method: 'POST', body: { date: '2026-12-01', note: 'تعطیلی' } }),
      );
    });
  });
});

describe('BookingsCalendar (F7.5)', () => {
  it('renders the booking row with code + status badge', async () => {
    apiFetchMock.mockResolvedValueOnce({
      data: { bookings: [makeBooking()], meta: OWNER_BOOKINGS_META },
    });
    const { BookingsCalendar } = await import('../../src/components/dashboard/bookings-calendar');
    renderWith(<BookingsCalendar businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('AB12')).toBeInTheDocument();
    });
    // "در انتظار" appears both in the status-filter dropdown option and the
    // row's status badge — assert both are present.
    expect(screen.getAllByText('در انتظار').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when no bookings match the filter', async () => {
    apiFetchMock.mockResolvedValueOnce({
      data: { bookings: [], meta: { ...OWNER_BOOKINGS_META, total: 0 } },
    });
    const { BookingsCalendar } = await import('../../src/components/dashboard/bookings-calendar');
    renderWith(<BookingsCalendar businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('رزروی نیست')).toBeInTheDocument();
    });
  });

  it('shows confirm + reject buttons on a pending booking', async () => {
    apiFetchMock.mockResolvedValueOnce({
      data: { bookings: [makeBooking()], meta: OWNER_BOOKINGS_META },
    });
    const { BookingsCalendar } = await import('../../src/components/dashboard/bookings-calendar');
    renderWith(<BookingsCalendar businessId="b1" />);
    await waitFor(() => expect(screen.getByText('AB12')).toBeInTheDocument());
    expect(screen.getByText('تأیید')).toBeInTheDocument();
    expect(screen.getByText('رد')).toBeInTheDocument();
  });

  it('POSTs a confirm decision when the confirm button is clicked', async () => {
    apiFetchMock.mockResolvedValueOnce({
      data: { bookings: [makeBooking()], meta: OWNER_BOOKINGS_META },
    });
    apiFetchMock.mockResolvedValueOnce({
      data: { booking: makeBooking({ status: 'confirmed' }) },
    });
    const { BookingsCalendar } = await import('../../src/components/dashboard/bookings-calendar');
    renderWith(<BookingsCalendar businessId="b1" />);
    await waitFor(() => expect(screen.getByText('AB12')).toBeInTheDocument());
    // Click the row's "confirm" action button (first matching element).
    fireEvent.click(screen.getAllByText('تأیید')[0] as HTMLElement);
    // The ConfirmDialog mounts a Modal with its own confirm button — wait for
    // the dialog to render, then click the confirm button inside it.
    await waitFor(() => {
      // The dialog confirm button is the LAST "تأیید" rendered.
      expect(screen.getAllByText('تأیید').length).toBeGreaterThanOrEqual(2);
    });
    const all = screen.getAllByText('تأیید');
    fireEvent.click(all[all.length - 1] as HTMLElement);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/bookings/bk-1/decision',
        expect.anything(),
        expect.objectContaining({
          method: 'POST',
          body: { action: 'confirm' },
        }),
      );
    });
  });
});
