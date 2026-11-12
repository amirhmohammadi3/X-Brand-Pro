// @vitest-environment jsdom
/**
 * FollowButton component tests (F5.2). Covers:
 *  - anonymous gate: renders the login link and NEVER fires /follows/me (the
 *    membership query is disabled for guests);
 *  - follow on: membership says not-following → click → POST /follows/users/:id
 *    → the toast announces the follow;
 *  - follow off: membership says following → click → DELETE /follows/users/:id
 *    → the toast announces the removal;
 *  - business target: click → POST /follows/businesses/:id;
 *  - server 422 (self-follow) → the friendly selfFollow toast.
 *
 * The membership state derives from the cached GET /follows/me result (B5.2
 * has no per-target probe), so the stub answers that route for every
 * authenticated case.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { ToastProvider } from '../../src/components/ui/toast';
import { FollowButton } from '../../src/components/account/follow-button';
import { makeUser, okEnvelope, errorEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

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

/** Empty follow lists (the caller follows nothing yet). */
const emptyFollows = okEnvelope({ users: [], businesses: [] });

function renderButton(
  handler: RouteHandler,
  { authenticated = true, businessTarget = false } = {},
): Mock {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <AuthProvider initialUser={authenticated ? makeUser() : null} initialApiError={false}>
          <ToastProvider>
            <FollowButton
              targetType={businessTarget ? 'business' : 'user'}
              targetId={businessTarget ? BUSINESS_ID : USER_ID}
              targetName={businessTarget ? 'کافه دماوند' : 'سارا محمدی'}
            />
          </ToastProvider>
        </AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** Wait for the follow button to be enabled (membership probe resolved). */
async function buttonReady(): Promise<HTMLButtonElement> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const btn = screen.queryByTestId('follow-button');
      if (btn && !btn.hasAttribute('disabled')) {
        clearInterval(interval);
        resolve(btn as HTMLButtonElement);
      }
    }, 10);
  });
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

describe('FollowButton (F5.2)', () => {
  it('shows the login gate for anonymous visitors and never calls /follows/me', () => {
    const handler: RouteHandler = () => undefined; // every call would 404
    const fetchMock = renderButton(handler, { authenticated: false });

    expect(screen.getByTestId('follow-login-gate')).toBeInTheDocument();
    expect(screen.getByText('برای دنبال‌کردن وارد شوید', { exact: false })).toBeInTheDocument();
    const fired = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/follows/me'));
    expect(fired).toHaveLength(0);
  });

  it('follows a user via POST /follows/users/:id and toasts the follow', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/follows/me')) return { status: 200, body: emptyFollows };
      if (url.endsWith(`/follows/users/${USER_ID}`) && method === 'POST') {
        return {
          status: 201,
          body: okEnvelope({ kind: 'user', targetId: USER_ID, following: true }),
        };
      }
      return undefined;
    };
    const fetchMock = renderButton(handler);

    const btn = await buttonReady();
    expect(btn.getAttribute('data-following')).toBe('false');
    fireEvent.click(btn);

    await screen.findByText(/سارا محمدی.*دنبال شد/);
    expect(findCall(fetchMock, 'POST', `/follows/users/${USER_ID}`)).toBeTruthy();
  });

  it('unfollows via DELETE /follows/users/:id and toasts the removal', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/follows/me')) {
        return {
          status: 200,
          body: okEnvelope({
            users: [
              {
                id: USER_ID,
                username: 'sara',
                displayName: 'سارا محمدی',
                avatarUrl: null,
                followedAt: '2026-11-10T10:00:00Z',
              },
            ],
            businesses: [],
          }),
        };
      }
      if (url.endsWith(`/follows/users/${USER_ID}`) && method === 'DELETE') {
        return {
          status: 200,
          body: okEnvelope({ kind: 'user', targetId: USER_ID, following: false }),
        };
      }
      return undefined;
    };
    const fetchMock = renderButton(handler);

    const btn = await buttonReady();
    expect(btn.getAttribute('data-following')).toBe('true');
    fireEvent.click(btn);

    await screen.findByText(/سارا محمدی.*از دنبال‌شده‌ها حذف شد/);
    expect(findCall(fetchMock, 'DELETE', `/follows/users/${USER_ID}`)).toBeTruthy();
  });

  it('hits the business endpoint for a business target', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/follows/me')) return { status: 200, body: emptyFollows };
      if (url.endsWith(`/follows/businesses/${BUSINESS_ID}`) && method === 'POST') {
        return {
          status: 201,
          body: okEnvelope({ kind: 'business', targetId: BUSINESS_ID, following: true }),
        };
      }
      return undefined;
    };
    const fetchMock = renderButton(handler, { businessTarget: true });

    const btn = await buttonReady();
    fireEvent.click(btn);

    await screen.findByText(/کافه دماوند.*دنبال شد/);
    expect(findCall(fetchMock, 'POST', `/follows/businesses/${BUSINESS_ID}`)).toBeTruthy();
  });

  it('maps a 422 (self-follow) to the friendly selfFollow toast', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
      if (url.includes('/follows/me')) return { status: 200, body: emptyFollows };
      if (url.endsWith(`/follows/users/${USER_ID}`) && method === 'POST') {
        return {
          status: 422,
          body: errorEnvelope('UNPROCESSABLE', 'self-follow'),
        };
      }
      return undefined;
    };
    renderButton(handler);

    const btn = await buttonReady();
    fireEvent.click(btn);

    // 422 is a client error — no retry, one toast.
    await screen.findByText('نمی‌توانید خودتان را دنبال کنید.', {}, { timeout: 5000 });
  });
});
