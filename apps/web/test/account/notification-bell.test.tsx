// @vitest-environment jsdom
/**
 * NotificationBell component tests (F5.3). Covers:
 *  - anonymous: renders NOTHING and never fires the inbox probe;
 *  - authenticated with unread > 0: the badge shows the Persian-digit count;
 *  - authenticated with unread = 0: the bell renders without a badge;
 *  - the bell links to /account/notifications.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { NotificationBell } from '../../src/components/layout/notification-bell';
import { makeUser, okEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

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
    usePathname: () => '/fa/',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

function renderBell(handler: RouteHandler, { authenticated = true } = {}): Mock {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <AuthProvider initialUser={authenticated ? makeUser() : null} initialApiError={false}>
          <NotificationBell />
        </AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('NotificationBell (F5.3)', () => {
  it('renders nothing for anonymous visitors and never fires the probe', () => {
    const fetchMock = renderBell(() => undefined, { authenticated: false });
    expect(screen.queryByTestId('notification-bell')).not.toBeInTheDocument();
    const fired = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/notifications/me/inbox'),
    );
    expect(fired).toHaveLength(0);
  });

  it('shows the Persian-digit unread badge for an authenticated user', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/inbox')) {
        return {
          status: 200,
          body: okEnvelope({
            items: [],
            meta: { page: 1, pageSize: 1, total: 3, totalPages: 0 },
            unread: 3,
          }),
        };
      }
      return undefined;
    };
    const fetchMock = renderBell(handler);

    await waitFor(() => {
      expect(screen.getByTestId('notification-bell-badge')).toHaveTextContent('۳');
    });
    // The probe is the cheap page-size-1 read.
    const probe = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/notifications/me/inbox') &&
        String(call[0]).includes('pageSize=1'),
    );
    expect(probe.length).toBeGreaterThan(0);
    // Bell links to the notification center.
    expect(screen.getByTestId('notification-bell').getAttribute('href')).toContain(
      '/account/notifications',
    );
  });

  it('renders the bell without a badge when everything is read', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/inbox')) {
        return {
          status: 200,
          body: okEnvelope({
            items: [],
            meta: { page: 1, pageSize: 1, total: 0, totalPages: 0 },
            unread: 0,
          }),
        };
      }
      return undefined;
    };
    renderBell(handler);

    await waitFor(() => {
      expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('notification-bell-badge')).not.toBeInTheDocument();
  });
});
