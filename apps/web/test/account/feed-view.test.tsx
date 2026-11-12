// @vitest-environment jsdom
/**
 * FeedView component tests (F5.2). Covers:
 *  - the unfiltered first page renders one line per activity type with the
 *    interpolated actor + business names;
 *  - switching to the reviews tab re-queries GET /feed with type=review.created;
 *  - the pagination control appears when meta.totalPages > 1 and page 2 is
 *    requested on click;
 *  - an empty feed renders the «follow someone» empty state;
 *  - a failed load renders the error state.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { FeedView } from '../../src/components/account/feed-view';
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
    usePathname: () => '/fa/account/feed',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const ACTOR_ID = '00000000-0000-0000-0000-0000000000d1';
const BUSINESS_ID = '00000000-0000-0000-0000-0000000000c1';

const actor = {
  id: ACTOR_ID,
  username: 'sara',
  displayName: 'سارا محمدی',
  avatarUrl: null,
};
const business = { id: BUSINESS_ID, slug: 'cafe-damavand', name: 'کافه دماوند' };

function feedItem(
  id: string,
  type: 'review.created' | 'question.created' | 'question.answered' | 'favorite.added',
  withBusiness = true,
) {
  return {
    id,
    type,
    actor,
    business: withBusiness ? business : null,
    subjectId: null,
    createdAt: '2026-11-12T08:30:00Z',
  };
}

const meta = { page: 1, pageSize: 10, total: 3, totalPages: 1 };
const metaTwoPages = { page: 1, pageSize: 10, total: 12, totalPages: 2 };

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
          <FeedView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** All fetch URLs that hit GET /feed (query string included). */
function feedCalls(fetchMock: Mock): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/feed'));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('FeedView (F5.2)', () => {
  it('renders the unfiltered first page with interpolated activity lines', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/feed')) {
        return {
          status: 200,
          body: okEnvelope({
            items: [
              feedItem('00000000-0000-0000-0000-000000000101', 'review.created'),
              feedItem('00000000-0000-0000-0000-000000000102', 'question.created'),
              feedItem('00000000-0000-0000-0000-000000000103', 'favorite.added'),
            ],
            meta,
          }),
        };
      }
      return undefined;
    };
    renderView(handler);

    expect(await screen.findByTestId('feed-list')).toBeInTheDocument();
    expect(screen.getByText(/سارا محمدی.*نظری برای «کافه دماوند» ثبت کرد/)).toBeInTheDocument();
    expect(screen.getByText(/سارا محمدی.*پرسشی دربارهٔ «کافه دماوند» پرسید/)).toBeInTheDocument();
    expect(
      screen.getByText(/سارا محمدی.*«کافه دماوند» را به علاقه‌مندی‌ها افزود/),
    ).toBeInTheDocument();
    // The business name links to the public business page.
    const links = screen.getAllByRole('link', { name: 'کافه دماوند' });
    expect(links[0]?.getAttribute('href')).toContain('/business/cafe-damavand');
  });

  it('re-queries with type=review.created when the reviews tab is activated', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/feed')) {
        return {
          status: 200,
          body: okEnvelope({
            items: [feedItem('00000000-0000-0000-0000-000000000101', 'review.created')],
            meta,
          }),
        };
      }
      return undefined;
    };
    const fetchMock = renderView(handler);

    await screen.findByTestId('feed-list');
    // Radix triggers respond to real pointer events — userEvent, not fireEvent.
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'نظرها' }));

    await vi.waitFor(() => {
      const typed = feedCalls(fetchMock).filter((url) => url.includes('type=review.created'));
      expect(typed.length).toBeGreaterThan(0);
    });
  });

  it('shows pagination when meta.totalPages > 1 and requests page 2', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/feed') && method === 'GET') {
        const isPage2 = url.includes('page=2');
        return {
          status: 200,
          body: okEnvelope({
            items: isPage2
              ? [feedItem('00000000-0000-0000-0000-000000000201', 'question.answered')]
              : [feedItem('00000000-0000-0000-0000-000000000101', 'review.created')],
            meta: isPage2 ? { ...metaTwoPages, page: 2 } : metaTwoPages,
          }),
        };
      }
      return undefined;
    };
    const fetchMock = renderView(handler);

    await screen.findByTestId('feed-list');
    // Next-page control (ui kit label: «صفحه بعد»). The kit renders an
    // LTR + RTL chevron pair (CSS-hides one per direction) — click the first.
    const user = userEvent.setup();
    const nextButtons = await screen.findAllByRole('button', { name: 'صفحه بعد' });
    await user.click(nextButtons[0] as HTMLElement);

    await vi.waitFor(() => {
      const page2 = feedCalls(fetchMock).filter((url) => url.includes('page=2'));
      expect(page2.length).toBeGreaterThan(0);
    });
    expect(await screen.findByText(/پاسخ داد/)).toBeInTheDocument();
  });

  it('renders the empty state for an empty feed', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/feed')) {
        return { status: 200, body: okEnvelope({ items: [], meta }) };
      }
      return undefined;
    };
    renderView(handler);

    await screen.findByText('فید شما خالی است');
    expect(screen.queryByTestId('feed-list')).not.toBeInTheDocument();
  });

  it('renders the error state when GET /feed fails', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/feed')) return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      return undefined;
    };
    renderView(handler);

    await screen.findByText('بارگذاری فید ممکن نشد.');
  });
});
