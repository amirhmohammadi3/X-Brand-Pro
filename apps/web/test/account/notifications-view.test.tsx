// @vitest-environment jsdom
/**
 * NotificationsView component tests (F5.3). Covers:
 *  - the inbox renders one row per notification with the text RE-RENDERED
 *    from the seed templates (`notifications.<eventKey>.title/.body` +
 *    payload vars) and the read/unread badges;
 *  - «علامت‌گذاری همه» fires POST /notifications/me/read with { all: true };
 *  - clicking an unread row fires POST with { ids: [id] } (a read row is a
 *    no-op);
 *  - the preferences tab renders the 5-event × 4-channel matrix and a
 *    toggle fires PUT with the PARTIAL merge body;
 *  - a failed load renders the error state.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { NotificationsView } from '../../src/components/account/notifications-view';
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
    usePathname: () => '/fa/account/notifications',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const ITEM_UNREAD = '00000000-0000-0000-0000-0000000003a1';
const ITEM_READ = '00000000-0000-0000-0000-0000000003a2';

const inboxEnvelope = okEnvelope({
  items: [
    {
      id: ITEM_UNREAD,
      eventKey: 'review.replied',
      payload: { actor: 'علی رضایی', business: 'کافه دماوند' },
      readAt: null,
      createdAt: '2026-11-12T08:00:00Z',
    },
    {
      id: ITEM_READ,
      eventKey: 'follow.created',
      payload: { actor: 'سارا محمدی' },
      readAt: '2026-11-12T09:00:00Z',
      createdAt: '2026-11-11T08:00:00Z',
    },
  ],
  meta: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
  unread: 1,
});

/** The five catalog events with the B5.3 default matrix (no overrides). */
const preferencesEnvelope = okEnvelope({
  preferences: [
    {
      eventKey: 'review.replied',
      channels: { inApp: true, email: true, sms: false, push: false },
      overridden: false,
    },
    {
      eventKey: 'review.voted',
      channels: { inApp: true, email: false, sms: false, push: false },
      overridden: false,
    },
    {
      eventKey: 'question.answered',
      channels: { inApp: true, email: true, sms: false, push: false },
      overridden: false,
    },
    {
      eventKey: 'follow.created',
      channels: { inApp: true, email: false, sms: false, push: false },
      overridden: false,
    },
    {
      eventKey: 'business.favorited',
      channels: { inApp: true, email: false, sms: false, push: false },
      overridden: false,
    },
  ],
});

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
          <NotificationsView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** Find the fetch call matching a method + URL substring (if any). */
function findCall(fetchMock: Mock, method: string, urlPart: string): unknown {
  return fetchMock.mock.calls.find((call) => {
    const init = call[1] as RequestInit | undefined;
    const m = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
    return m === method && String(call[0]).includes(urlPart);
  });
}

function bodyOf(call: unknown): Record<string, unknown> {
  const init = (call as [string, RequestInit])[1];
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('NotificationsView (F5.3)', () => {
  it('renders inbox rows re-rendered from the seed templates with badges', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/inbox')) return { status: 200, body: inboxEnvelope };
      return undefined;
    };
    renderView(handler);

    // Title + body come from the seeded templates + payload interpolation.
    expect(await screen.findByText('پاسخ جدید به نقد شما')).toBeInTheDocument();
    expect(screen.getByText(/علی رضایی.*کافه دماوند/)).toBeInTheDocument();
    expect(screen.getByText('دنبال‌کنندهٔ جدید')).toBeInTheDocument();
    // Read/unread badges per row state.
    expect(screen.getAllByText('خوانده‌نشده')).toHaveLength(1);
    expect(screen.getAllByText('خوانده‌شده')).toHaveLength(1);
    expect(screen.getByTestId('notifications-unread')).toHaveTextContent('۱');
  });

  it('marks everything read via POST /notifications/me/read { all: true }', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/notifications/me/inbox') && method === 'GET') {
        return { status: 200, body: inboxEnvelope };
      }
      if (url.endsWith('/notifications/me/read') && method === 'POST') {
        return { status: 200, body: okEnvelope({ marked: 1 }) };
      }
      return undefined;
    };
    const fetchMock = renderView(handler);

    const btn = await screen.findByTestId('mark-all-read');
    const user = userEvent.setup();
    await user.click(btn);

    // The toast text interpolates the marked count (digit rendering is
    // formatter-dependent — match the message, not the numeral).
    await screen.findByText(/اعلان خوانده‌شده علامت‌گذاری شد/);
    const call = findCall(fetchMock, 'POST', '/notifications/me/read');
    expect(call).toBeTruthy();
    expect(bodyOf(call)).toEqual({ all: true });
  });

  it('marks ONE unread row read via POST { ids: [id] } (read rows are no-ops)', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/notifications/me/inbox') && method === 'GET') {
        return { status: 200, body: inboxEnvelope };
      }
      if (url.endsWith('/notifications/me/read') && method === 'POST') {
        return { status: 200, body: okEnvelope({ marked: 1 }) };
      }
      return undefined;
    };
    const fetchMock = renderView(handler);

    const rows = await screen.findAllByTestId('notification-row');
    expect(rows).toHaveLength(2);
    // The FIRST row is the unread one (newest first).
    expect(rows[0]?.getAttribute('data-read')).toBe('false');
    const user = userEvent.setup();
    await user.click(rows[0] as HTMLElement);

    await vi.waitFor(() => {
      const call = findCall(fetchMock, 'POST', '/notifications/me/read');
      expect(call).toBeTruthy();
      expect(bodyOf(call)).toEqual({ ids: [ITEM_UNREAD] });
    });
  });

  it('renders the preference matrix and PUTs a partial channel merge on toggle', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/notifications/me/inbox') && method === 'GET') {
        return { status: 200, body: inboxEnvelope };
      }
      if (url.includes('/notifications/me/preferences') && method === 'GET') {
        return { status: 200, body: preferencesEnvelope };
      }
      if (url.includes('/notifications/me/preferences') && method === 'PUT') {
        return { status: 200, body: preferencesEnvelope };
      }
      return undefined;
    };
    const fetchMock = renderView(handler);

    await screen.findByTestId('notifications-list');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'ترجیحات' }));

    const rows = await screen.findAllByTestId('preference-row');
    expect(rows).toHaveLength(5);
    // Each event row exposes 4 channel switches → 20 switches total.
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(20);

    // Flip the SMS switch OF THE FIRST ROW (review.replied ships email ON per
    // the B5.3 defaults, so SMS false→true is the cleanest flip); every row
    // carries its own switches, so the query must be scoped.
    const firstRow = rows[0] as HTMLElement;
    expect(within(firstRow).getByText('پاسخ به نقد شما')).toBeInTheDocument();
    await user.click(within(firstRow).getByRole('switch', { name: /پیامک/ }));

    await vi.waitFor(() => {
      const call = findCall(fetchMock, 'PUT', '/notifications/me/preferences');
      expect(call).toBeTruthy();
      expect(bodyOf(call)).toEqual({
        eventKey: 'review.replied',
        channels: { sms: true },
      });
    });
  });

  it('renders the error state when the inbox fails', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/inbox')) {
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      }
      return undefined;
    };
    renderView(handler);

    await screen.findByText('بارگذاری اعلان‌ها ممکن نشد.');
  });
});
