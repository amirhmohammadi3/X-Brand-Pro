// @vitest-environment jsdom
/**
 * FollowingView component tests (F5.2). Covers:
 *  - both sections render from one GET /follows/me (counts, user row,
 *    business card);
 *  - unfollowing a user fires DELETE /follows/users/:id and toasts;
 *  - an empty result renders the global empty state;
 *  - a failed load renders the error state.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { FollowingView } from '../../src/components/account/following-view';
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
    usePathname: () => '/fa/account/following',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const USER_ID = '00000000-0000-0000-0000-0000000000d1';
const BUSINESS_ID = '00000000-0000-0000-0000-0000000000c1';

const SUMMARY = {
  id: BUSINESS_ID,
  slug: 'cafe-damavand',
  name: 'کافه دماوند',
  nameAlt: null,
  primaryCategory: {
    id: '00000000-0000-0000-0000-0000000000e1',
    slug: 'cafe',
    name: { fa: 'کافه', en: 'Cafe' },
  },
  city: {
    id: '00000000-0000-0000-0000-0000000000e2',
    slug: 'tehran',
    name: { fa: 'تهران', en: 'Tehran' },
  },
  neighborhood: null,
  address: 'ولیعصر، پلاک ۱',
  location: { lat: 35.7, lng: 51.4 },
  priceLevel: 2,
  avgRating: 4.5,
  reviewCount: 12,
  coverUrl: null,
  thumbUrl: null,
  isFeatured: false,
  isClaimed: true,
};

const followsEnvelope = okEnvelope({
  users: [
    {
      id: USER_ID,
      username: 'sara',
      displayName: 'سارا محمدی',
      avatarUrl: null,
      followedAt: '2026-11-10T10:00:00Z',
    },
  ],
  businesses: [{ business: SUMMARY, followedAt: '2026-11-11T09:00:00Z' }],
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
          <FollowingView />
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('FollowingView (F5.2)', () => {
  it('renders both follow sections from one GET /follows/me', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/follows/me')) return { status: 200, body: followsEnvelope };
      return undefined;
    };
    renderView(handler);

    // The view renders a spinner first; the title lands with the data.
    expect(await screen.findByText('دنبال‌شده‌ها')).toBeInTheDocument();
    expect(await screen.findByTestId('following-businesses-list')).toBeInTheDocument();
    expect(screen.getByTestId('following-users-list')).toBeInTheDocument();
    // The user row carries the display name + @username.
    expect(screen.getByText('سارا محمدی')).toBeInTheDocument();
    expect(screen.getByText('@sara')).toBeInTheDocument();
    // The business card shows the name and links to the public page.
    expect(screen.getByText('کافه دماوند')).toBeInTheDocument();
  });

  it('unfollows a user via DELETE and toasts the removal', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/follows/me')) return { status: 200, body: followsEnvelope };
      if (url.endsWith(`/follows/users/${USER_ID}`) && method === 'DELETE') {
        return {
          status: 200,
          body: okEnvelope({ kind: 'user', targetId: USER_ID, following: false }),
        };
      }
      return undefined;
    };
    const fetchMock = renderView(handler);

    const row = await screen.findByTestId(`unfollow-user-${USER_ID}`);
    fireEvent.click(row);

    await screen.findByText(/سارا محمدی.*از فهرست دنبال‌شده‌ها حذف شد/);
    expect(findCall(fetchMock, 'DELETE', `/follows/users/${USER_ID}`)).toBeTruthy();
  });

  it('renders the global empty state when both lists are empty', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/follows/me'))
        return { status: 200, body: okEnvelope({ users: [], businesses: [] }) };
      return undefined;
    };
    renderView(handler);

    await screen.findByText('هنوز کسی را دنبال نمی‌کنید');
    expect(screen.queryByTestId('following-businesses-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('following-users-list')).not.toBeInTheDocument();
  });

  it('renders the error state when GET /follows/me fails', async () => {
    const handler: RouteHandler = (url) => {
      if (url.includes('/follows/me'))
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      return undefined;
    };
    renderView(handler);

    await screen.findByText('بارگذاری دنبال‌شده‌ها ممکن نشد.');
  });
});
