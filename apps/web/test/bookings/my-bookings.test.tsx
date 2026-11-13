// @vitest-environment jsdom
/**
 * MyBookingsView tests (F6.2). Covers:
 *  - the list renders scope tabs + booking rows with status badges;
 *  - the calendar feed section fetches the token and shows the feed URL;
 *  - cancel: confirm dialog → POST /bookings/:id/cancel fires;
 *  - the server's cancel-window 422 surfaces the dedicated toast message.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { okEnvelope, errorEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

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
    usePathname: () => '/fa/bookings',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const useAuthMock = vi.fn();
vi.mock('../../src/lib/auth/auth-context', () => ({ useAuth: useAuthMock }));

const { MyBookingsView } = await import('../../src/components/bookings/my-bookings');

const USER_ID = '00000000-0000-0000-0000-000000000011';
const BOOKING_ID = '00000000-0000-0000-0000-0000000000b1';

const bookingRow = {
  id: BOOKING_ID,
  businessId: '00000000-0000-0000-0000-0000000000c1',
  serviceId: '00000000-0000-0000-0000-000000000051',
  userId: USER_ID,
  date: '2026-11-20',
  startTime: '19:00:00',
  endTime: '20:00:00',
  partySize: 2,
  status: 'confirmed',
  contactName: null,
  contactPhone: null,
  note: null,
  code: 'ABCD2345',
  cancelActor: null,
  cancelReason: null,
  confirmedAt: '2026-11-12T01:00:00Z',
  cancelledAt: null,
  createdAt: '2026-11-12T00:00:00Z',
  updatedAt: '2026-11-12T00:00:00Z',
  serviceName: 'میز دوتنفره',
  businessName: 'کافه دماوند',
  businessSlug: 'cafe-damavand',
};

const cancelledRow = {
  ...bookingRow,
  status: 'cancelled',
  cancelActor: 'user',
  cancelledAt: '2026-11-12T02:00:00Z',
};

function renderView(handler: RouteHandler): Mock {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>
          <MyBookingsView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const baseHandler: RouteHandler = (url, init) => {
  if (url.includes('/bookings/me/calendar-token')) {
    return { status: 200, body: okEnvelope({ token: 'a'.repeat(32) }) };
  }
  if (url.includes('/bookings/me') && (init?.method ?? 'GET') === 'GET') {
    return {
      status: 200,
      body: okEnvelope({
        bookings: [bookingRow],
        meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
      }),
    };
  }
  if (url.includes('/bookings/') && url.includes('/cancel')) {
    return { status: 200, body: okEnvelope({ booking: cancelledRow }) };
  }
  return undefined;
};

describe('MyBookingsView — F6.2', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      user: {
        id: USER_ID,
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

  it('renders the upcoming list with status badges and the feed URL', async () => {
    renderView(baseHandler);
    await waitFor(() => expect(screen.getAllByTestId('booking-row')).toHaveLength(1));
    expect(screen.getByText('کافه دماوند')).toBeTruthy();
    expect(screen.getByText('میز دوتنفره')).toBeTruthy();
    // The status text appears as a badge AND a filter chip — assert within the row.
    const row = screen.getAllByTestId('booking-row')[0] as HTMLElement;
    expect(row.textContent).toContain('تأییدشده');
    expect(row.textContent).toContain('ABCD2345');
    // The feed URL carries the user id + the token query.
    expect(screen.getByText(/\/bookings\/user\//)).toBeTruthy();
    expect(screen.getByText(/token=/)).toBeTruthy();
  });

  it('cancels through the confirm dialog and fires the POST', async () => {
    const fetchMock = renderView(baseHandler);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getAllByTestId('booking-row')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'لغو این رزرو' }));

    // The dialog asks for confirmation with the booking code (the row shows
    // the code too, so expect at least two matches).
    expect(screen.getAllByText(/ABCD2345/).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole('button', { name: 'بله، لغو کن' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, init]) => String(u).includes('/cancel') && init?.method === 'POST',
      );
      expect(post).toBeTruthy();
    });
    expect(screen.getByText('رزرو لغو شد.')).toBeTruthy();
  });

  it('surfaces the cancel-window policy refusal from the server', async () => {
    const handler: RouteHandler = (url, init) => {
      if (url.includes('/bookings/') && url.includes('/cancel')) {
        return {
          status: 422,
          body: errorEnvelope('UNPROCESSABLE', 'window', { reason: 'cancel_window' }),
        };
      }
      return baseHandler(url, init);
    };
    renderView(handler);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getAllByTestId('booking-row')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'لغو این رزرو' }));
    await user.click(screen.getByRole('button', { name: 'بله، لغو کن' }));

    await waitFor(() =>
      expect(screen.getByText('مهلت لغو رایگان این رزرو گذشته است.')).toBeTruthy(),
    );
  });

  it('shows the empty state when the scope has no rows', async () => {
    const handler: RouteHandler = (url, init) => {
      if (url.includes('/bookings/me') && (init?.method ?? 'GET') === 'GET') {
        return {
          status: 200,
          body: okEnvelope({
            bookings: [],
            meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
          }),
        };
      }
      return baseHandler(url, init);
    };
    renderView(handler);
    await waitFor(() => expect(screen.getByText('هنوز رزروی ثبت نکرده‌اید.')).toBeTruthy());
  });
});
