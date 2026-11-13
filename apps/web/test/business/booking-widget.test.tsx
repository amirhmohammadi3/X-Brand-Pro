// @vitest-environment jsdom
/**
 * BookingWidget tests (F6.1). Covers the four-step flow against the real
 * seed messages and a stubbed fetch:
 *  - a business WITHOUT active services renders nothing (no widget shell);
 *  - service pill → availability grid renders (slots marked available);
 *  - picking a slot opens the confirm card; submit POSTs /bookings with the
 *    grid-aligned local time and shows the booking code;
 *  - anonymous visitors get the login hint instead of the submit button.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { okEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return {
    Link,
    usePathname: () => '/fa/business/x',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const useAuthMock = vi.fn();
vi.mock('../../src/lib/auth/auth-context', () => ({ useAuth: useAuthMock }));

const { BookingWidget } = await import('../../src/components/business/booking-widget');

const BUSINESS_ID = '00000000-0000-0000-0000-0000000000c1';
const SERVICE_ID = '00000000-0000-0000-0000-000000000051';

const service = {
  id: SERVICE_ID,
  businessId: BUSINESS_ID,
  name: 'میز دوتنفره',
  description: 'کنار پنجره',
  durationMinutes: 60,
  slotStepMinutes: 30,
  capacity: 2,
  minPartySize: 1,
  maxPartySize: 6,
  minLeadMinutes: 0,
  cancelWindowMinutes: 120,
  maxAdvanceDays: 30,
  isActive: true,
  sortOrder: 0,
  createdAt: '2026-11-12T00:00:00Z',
  updatedAt: '2026-11-12T00:00:00Z',
};

const availability = {
  serviceId: SERVICE_ID,
  date: '2026-11-20',
  closed: false,
  slots: [
    { start: '18:00', available: true },
    { start: '18:30', available: false },
    { start: '19:00', available: true },
  ],
};

const createdBooking = {
  id: '00000000-0000-0000-0000-0000000000b1',
  businessId: BUSINESS_ID,
  serviceId: SERVICE_ID,
  userId: '00000000-0000-0000-0000-000000000011',
  date: '2026-11-20',
  startTime: '19:00:00',
  endTime: '20:00:00',
  partySize: 2,
  status: 'pending',
  contactName: null,
  contactPhone: null,
  note: null,
  code: 'ABCD2345',
  cancelActor: null,
  cancelReason: null,
  confirmedAt: null,
  cancelledAt: null,
  createdAt: '2026-11-12T00:00:00Z',
  updatedAt: '2026-11-12T00:00:00Z',
};

function renderWidget(handler: RouteHandler): Mock {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>
          <BookingWidget businessId={BUSINESS_ID} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const baseHandler: RouteHandler = (url, init) => {
  if (url.includes('/bookings/services')) {
    return { status: 200, body: okEnvelope({ services: [service] }) };
  }
  if (url.includes('/bookings/availability')) {
    return { status: 200, body: okEnvelope(availability) };
  }
  if (url.includes('/bookings') && (init?.method ?? 'GET') === 'POST') {
    return { status: 200, body: okEnvelope({ booking: createdBooking }) };
  }
  return undefined;
};

describe('BookingWidget — F6.1', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      user: {
        id: '00000000-0000-0000-0000-000000000011',
        username: 'tester',
        displayName: 'تستر',
        phone: null,
        role: 'user',
        status: 'active',
      },
      status: 'authenticated',
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing when the business has no active services', () => {
    renderWidget((url) => {
      if (url.includes('/bookings/services')) {
        return { status: 200, body: okEnvelope({ services: [] }) };
      }
      return undefined;
    });
    expect(screen.queryByTestId('booking-widget')).toBeNull();
  });

  it('walks the flow: service → slots → confirm card → created code', async () => {
    const fetchMock = renderWidget(baseHandler);
    const user = userEvent.setup();

    // The widget renders (services loaded) and shows the service pill.
    await waitFor(() => expect(screen.getByTestId('booking-widget')).toBeTruthy());
    const pill = screen.getByRole('radio', { name: 'میز دوتنفره' });
    await user.click(pill);

    // Slots render; the unavailable one is disabled.
    await waitFor(() => expect(screen.getByRole('radio', { name: '18:00' })).toBeTruthy());
    const taken = screen.getByRole('radio', { name: '18:30' });
    expect(taken.hasAttribute('disabled')).toBe(true);

    // Pick a free slot → the confirm card appears with party stepper.
    await user.click(screen.getByRole('radio', { name: '19:00' }));
    expect(screen.getByText('تعداد نفرات')).toBeTruthy();

    // Submit → POST /bookings → the success card with the code (the toast
    // repeats it, so query within the card).
    await user.click(screen.getByRole('button', { name: 'ثبت رزرو' }));
    await waitFor(() => expect(screen.getByTestId('booking-success')).toBeTruthy());
    const success = screen.getByTestId('booking-success');
    expect(success.textContent).toContain('ABCD2345');

    const post = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith('/bookings') && (init?.method ?? 'GET') === 'POST',
    );
    expect(post).toBeTruthy();
    const body = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      startTime: '19:00',
      partySize: 1,
    });
  });

  it('shows the login hint for anonymous visitors instead of the submit', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    renderWidget(baseHandler);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('booking-widget')).toBeTruthy());
    await user.click(screen.getByRole('radio', { name: 'میز دوتنفره' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: '19:00' })).toBeTruthy());
    await user.click(screen.getByRole('radio', { name: '19:00' }));

    expect(screen.getByText('برای ثبت رزرو وارد حساب خود شوید.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ثبت رزرو' })).toBeNull();
    // The login link points at /login.
    expect(screen.getByText('ورود').closest('a')?.getAttribute('href')).toBe('/login');
  });
});
