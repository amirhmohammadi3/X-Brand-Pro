// @vitest-environment jsdom
/**
 * FavoriteToggle component tests (F5.1). Covers:
 *  - heart-on: probe says not favorited → click → POST /favorites/items →
 *    the toast announces the save.
 *  - heart-off: probe says favorited → click → DELETE /favorites/items/:id →
 *    the toast announces the removal.
 *  - server error: POST 500 → the errors.internal_error toast (useApiMutation
 *    retries 5xx once, so the assertion allows time for the retry+reject).
 *
 * The assertions verify the right HTTP method+URL was fired (via the stubbed
 * fetch mock) and the toast rendered — the core behavior. The optimistic
 * probe-flip is exercised in production via setQueryData; here we assert the
 * write actually landed rather than depend on the jsdom re-render timing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { FavoriteToggle } from '../../src/components/business/favorite-toggle';
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
    usePathname: () => '/fa/business/x',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const BUSINESS_ID = '00000000-0000-0000-0000-0000000000c1';
const LIST_ID = '00000000-0000-0000-0000-0000000000a1';
const ITEM_ID = '00000000-0000-0000-0000-0000000000b1';

function renderToggle(handler: RouteHandler): Mock {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>
          <FavoriteToggle businessId={BUSINESS_ID} businessName="کافه دماوند" />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** Wait for the toggle to be enabled (probe resolved). */
async function toggleEnabled(): Promise<HTMLElement> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const btn = screen.queryByTestId('favorite-toggle');
      if (btn && !btn.hasAttribute('disabled')) {
        clearInterval(interval);
        resolve(btn);
      }
    }, 10);
  });
}

/** Find the fetch call matching a method + URL substring (if any). */
function findCall(fetchMock: Mock, method: string, urlPart: string): unknown {
  return fetchMock.mock.calls.find((call) => {
    // mock.calls is any[][] — index (no tuple destructure) to keep tsc happy.
    const init = call[1] as RequestInit | undefined;
    const m = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
    return m === method && String(call[0]).includes(urlPart);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('FavoriteToggle (F5.1)', () => {
  it('turns the heart on via POST /favorites/items and toasts the save', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/favorites/me/check')) {
        return {
          status: 200,
          body: okEnvelope({
            businessId: BUSINESS_ID,
            favorited: false,
            listId: null,
            listName: null,
            itemId: null,
          }),
        };
      }
      if (url.endsWith('/favorites/items') && method === 'POST') {
        return {
          status: 201,
          body: okEnvelope({
            id: ITEM_ID,
            listId: LIST_ID,
            businessId: BUSINESS_ID,
            note: null,
            createdAt: '2026-11-12T00:00:00Z',
          }),
        };
      }
      return undefined;
    };
    const fetchMock = renderToggle(handler);

    const btn = await toggleEnabled();
    expect(btn.getAttribute('data-favorited')).toBe('false');
    fireEvent.click(btn);

    await screen.findByText(/کافه دماوند.*به علاقه‌مندی‌ها اضافه شد/);
    expect(findCall(fetchMock, 'POST', '/favorites/items')).toBeTruthy();
  });

  it('turns the heart off via DELETE /favorites/items/:id and toasts the removal', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/favorites/me/check')) {
        return {
          status: 200,
          body: okEnvelope({
            businessId: BUSINESS_ID,
            favorited: true,
            listId: LIST_ID,
            listName: 'علاقه‌مندی‌ها',
            itemId: ITEM_ID,
          }),
        };
      }
      if (url.includes(`/favorites/items/${ITEM_ID}`) && method === 'DELETE') {
        return { status: 200, body: okEnvelope({ deleted: true }) };
      }
      return undefined;
    };
    const fetchMock = renderToggle(handler);

    const btn = await toggleEnabled();
    expect(btn.getAttribute('data-favorited')).toBe('true');
    fireEvent.click(btn);

    await screen.findByText(/کافه دماوند.*از علاقه‌مندی‌ها برداشته شد/);
    expect(findCall(fetchMock, 'DELETE', `/favorites/items/${ITEM_ID}`)).toBeTruthy();
  });

  it('surfaces a server error toast when POST /favorites/items fails (500)', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/favorites/me/check')) {
        return {
          status: 200,
          body: okEnvelope({
            businessId: BUSINESS_ID,
            favorited: false,
            listId: null,
            listName: null,
            itemId: null,
          }),
        };
      }
      if (url.endsWith('/favorites/items') && method === 'POST') {
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      }
      return undefined;
    };
    renderToggle(handler);

    const btn = await toggleEnabled();
    fireEvent.click(btn);
    // 500 → useApiMutation retries once (5xx), so allow time for the retry+reject.
    // mapFavoriteError returns tRoot('errors.internal_error') for the messageKey.
    await screen.findByText('خطایی از سمت ما رخ داد؛ دوباره تلاش کنید.', {}, { timeout: 5000 });
  });
});
