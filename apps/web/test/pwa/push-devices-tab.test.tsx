// @vitest-environment jsdom
/**
 * PushDevicesTab component tests (F5.4). Covers:
 *  - the device list renders one row per saved subscription (userAgent +
 *    endpoint), and a DELETE button fires `remove(id)` → DELETE
 *    /notifications/me/push/subscriptions/:id;
 *  - the enable-push button calls `subscribe()` and shows the success toast;
 *  - a `subscribe()` that returns `{ ok: false, error: 'denied' }` shows the
 *    localized denied toast (the toast text is i18n-keyed, not a raw token);
 *  - the empty state renders when the device list is empty;
 *  - the load error renders when the device list fetch fails.
 *
 * `useServiceWorker` and the `subscribe`/`remove` callbacks are mocked (jsdom
 * has no real `serviceWorker`/`PushManager`); `usePushDevices` runs against
 * the stubbed `fetch` so the device-list rendering path is exercised for
 * real.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { PushDevicesTab } from '../../src/components/pwa/push-devices-tab';
import { okEnvelope, errorEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';
import type { PushSubscribeOutcome } from '../../src/lib/pwa/use-push-subscription';

// Hoisted mutable stubs for the parts jsdom can't provide: the SW state and
// the subscribe()/remove() callbacks. usePushDevices runs for real so the
// device-list rendering is covered end-to-end against the stubbed fetch.
const { swState, subscribeImpl, removeImpl } = vi.hoisted(() => ({
  swState: {
    value: 'unsupported' as 'unsupported' | 'ready' | 'error' | 'loading',
  },
  subscribeImpl: {
    fn: vi.fn(async () => ({ ok: true, subscriptionId: 'sub-1' }) as PushSubscribeOutcome),
  },
  removeImpl: { fn: vi.fn(async (_id: string) => ({ deleted: true })) },
}));

vi.mock('../../src/lib/pwa/use-service-worker', () => ({
  useServiceWorker: () => swState.value,
}));

vi.mock('../../src/lib/pwa/use-push-subscription', async () => {
  // The factory is async so `importActual` works; no `typeof import(...)`
  // type annotation (the consistent-type-imports rule forbids that form).
  const real = (await vi.importActual('../../src/lib/pwa/use-push-subscription')) as Record<
    string,
    unknown
  >;
  return {
    ...real,
    // usePushDevices stays real (exercises the fetch path); only the
    // SW-dependent subscribe/remove are stubbed.
    usePushSubscription: () => ({
      subscribe: subscribeImpl.fn,
      remove: removeImpl.fn,
    }),
  };
});

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    href: string;
  };
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

const DEVICE_ID = '00000000-0000-4000-8000-000000000d01';

function renderTab(handler: RouteHandler): Mock {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>
          <PushDevicesTab />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

beforeEach(() => {
  swState.value = 'unsupported';
  subscribeImpl.fn = vi.fn(
    async () => ({ ok: true, subscriptionId: 'sub-1' }) as PushSubscribeOutcome,
  );
  removeImpl.fn = vi.fn(async (_id: string) => ({ deleted: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('PushDevicesTab (F5.4)', () => {
  it('renders one row per saved subscription and DELETEs on click', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/notifications/me/push/subscriptions') && method === 'GET') {
        return {
          status: 200,
          body: okEnvelope({
            items: [
              {
                id: DEVICE_ID,
                endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
                createdAt: '2026-11-12T08:00:00Z',
              },
            ],
          }),
        };
      }
      if (
        url.includes(`/notifications/me/push/subscriptions/${DEVICE_ID}`) &&
        method === 'DELETE'
      ) {
        return { status: 200, body: okEnvelope({ deleted: true }) };
      }
      return undefined;
    };
    renderTab(handler);

    const rows = await screen.findAllByTestId('push-device-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByText(/Macintosh/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('push-device-remove'));

    await waitFor(() => {
      expect(removeImpl.fn).toHaveBeenCalledWith(DEVICE_ID);
    });
    // The success toast text comes from the fa seed.
    await screen.findByText(/دستگاه حذف شد/);
  });

  it('calls subscribe() on the enable button and toasts success', async () => {
    swState.value = 'ready';
    // The component double-checks `PushManager in window` even when the SW is
    // ready (some browsers ship serviceWorker without Push); stub it present.
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: class {},
    });
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/push/subscriptions')) {
        return { status: 200, body: okEnvelope({ items: [] }) };
      }
      return undefined;
    };
    renderTab(handler);

    const btn = await screen.findByTestId('push-enable');
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(subscribeImpl.fn).toHaveBeenCalledTimes(1);
    });
    await screen.findByText(/پوش برای این دستگاه فعال شد/);
  });

  it('renders the localized denied toast when subscribe() returns denied', async () => {
    swState.value = 'ready';
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: class {},
    });
    subscribeImpl.fn = vi.fn(async () => ({ ok: false, error: 'denied' }) as PushSubscribeOutcome);
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/push/subscriptions')) {
        return { status: 200, body: okEnvelope({ items: [] }) };
      }
      return undefined;
    };
    renderTab(handler);

    const btn = await screen.findByTestId('push-enable');
    const user = userEvent.setup();
    await user.click(btn);

    await screen.findByText(/مسدود کرده‌اید/);
  });

  it('renders the empty state when there are no devices', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/push/subscriptions')) {
        return { status: 200, body: okEnvelope({ items: [] }) };
      }
      return undefined;
    };
    renderTab(handler);
    expect(await screen.findByText('هنوز دستگاهی ثبت نشده')).toBeInTheDocument();
  });

  it('renders the load error when the device list fails', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/notifications/me/push/subscriptions')) {
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      }
      return undefined;
    };
    renderTab(handler);
    await screen.findByText('بارگذاری دستگاه‌ها ممکن نشد.');
  });
});
