// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { qk } from '../../src/lib/api/qk';
import { LoginForm } from '../../src/components/auth/login-form';
import {
  makeUser,
  okEnvelope,
  errorEnvelope,
  renderAuth,
  stubFetch,
  routerReplace,
} from './helpers';

// Hoisted mock — next-intl's navigation pulls `next/navigation`, which is
// unresolvable under pnpm strict isolation in vitest; the auth pages only
// need <Link> and the router doubles.
vi.mock('@/i18n/navigation', async () => {
  const { routerPush, routerReplace: replace } = await import('./helpers');
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
    usePathname: () => '/account',
    useRouter: () => ({ push: routerPush, replace }),
  };
});

const API = 'http://localhost:4000/api/v1';

const authResult = {
  user: makeUser({ emailVerified: true, phoneVerified: true }),
  accessExpiresAt: '2026-11-04T12:00:00Z',
};

function fill(identifier: string, password: string) {
  // Labels carry the platform's required marker, so match loosely.
  fireEvent.change(screen.getByLabelText(/نام کاربری، ایمیل یا شماره موبایل/), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText(/گذرواژه/), { target: { value: password } });
}

beforeEach(() => {
  routerReplace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LoginForm (F1.8) — validation', () => {
  it('shows required-field errors and never calls the API when empty', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAuth(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    await act(async () => {});
    expect(screen.getAllByText('این فیلد الزامی است.').length).toBeGreaterThanOrEqual(1);
    // The oauth-providers query may fetch the public settings; no auth call.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/auth/login'))).toBe(true);
  });
});

describe('LoginForm (F1.8) — server error mapping', () => {
  it('maps INVALID_CREDENTIALS to the translated message', async () => {
    stubFetch((url) =>
      url.includes('/auth/login')
        ? { status: 401, body: errorEnvelope('INVALID_CREDENTIALS') }
        : undefined,
    );
    renderAuth(<LoginForm />);
    fill('ali_reza', 'wrong-pass-1');
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    expect(await screen.findByText('نام کاربری یا گذرواژه درست نیست.')).toBeInTheDocument();
  });

  it('maps ACCOUNT_BANNED to a clear message', async () => {
    stubFetch((url) =>
      url.includes('/auth/login')
        ? { status: 403, body: errorEnvelope('ACCOUNT_BANNED') }
        : undefined,
    );
    renderAuth(<LoginForm />);
    fill('ali_reza', 'whatever1');
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    expect(
      await screen.findByText('این حساب مسدود شده است. برای پیگیری با پشتیبانی تماس بگیرید.'),
    ).toBeInTheDocument();
  });

  it('maps RATE_LIMITED to a wait time from retryAfterSec', async () => {
    vi.useFakeTimers();
    stubFetch((url) =>
      url.includes('/auth/login')
        ? { status: 429, body: errorEnvelope('RATE_LIMITED', 'Too many', { retryAfterSec: 30 }) }
        : undefined,
    );
    renderAuth(<LoginForm />);
    fill('ali_reza', 'whatever1');
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    await act(async () => {});
    expect(
      screen.getByText('درخواست‌های شما زیاد است؛ ۳۰ ثانیه دیگر دوباره تلاش کنید.'),
    ).toBeInTheDocument();
  });

  it('starts a visible countdown on ACCOUNT_LOCKED and re-enables submit after it elapses', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch((url) =>
      url.includes('/auth/login')
        ? { status: 429, body: errorEnvelope('ACCOUNT_LOCKED', 'Locked', { retryAfterSec: 90 }) }
        : undefined,
    );
    const loginCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/login')).length;
    renderAuth(<LoginForm />);
    fill('ali_reza', 'whatever1');
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    await act(async () => {});
    expect(
      screen.getByText('به دلیل تلاش‌های ناموفق، ورود برای ۹۰ ثانیه در دسترس نیست.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ورود' })).toBeDisabled();
    expect(loginCalls()).toBe(1);

    // While locked the disabled button blocks further submits client-side.
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    await act(async () => {});
    expect(loginCalls()).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(91_000);
    });
    expect(screen.getByRole('button', { name: 'ورود' })).toBeEnabled();
    expect(
      screen.queryByText('به دلیل تلاش‌های ناموفق، ورود برای ۹۰ ثانیه در دسترس نیست.'),
    ).not.toBeInTheDocument();
  });
});

describe('LoginForm (F1.8) — safe next handling', () => {
  it('replaces the URL with a RELATIVE next after a successful login and seeds the cache', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/auth/login') ? { status: 200, body: okEnvelope(authResult) } : undefined,
    );
    const queryClient = renderAuth(<LoginForm initialNext="/account" />);
    fill('ali_reza', 'correct-horse1');
    fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
    await act(async () => {});
    await act(async () => {});
    expect(routerReplace).toHaveBeenCalledWith('/account');
    expect(queryClient.getQueryData(qk.auth.me())).toMatchObject({ username: 'tester' });
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/login'));
    expect(loginCall).toBeDefined();
    const [, init] = loginCall as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('ali_reza');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil', 'javascript:alert(1)'])(
    'falls back to "/" for an unsafe next (%s)',
    async (unsafe) => {
      stubFetch((url) =>
        url.includes('/auth/login') ? { status: 200, body: okEnvelope(authResult) } : undefined,
      );
      renderAuth(<LoginForm initialNext={unsafe} />);
      fill('ali_reza', 'correct-horse1');
      fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
      await act(async () => {});
      await act(async () => {});
      expect(routerReplace).toHaveBeenCalledWith('/');
    },
  );
});

describe('LoginForm (F1.8) — Google button', () => {
  it('shows the Google start link only when the public setting enables it', async () => {
    stubFetch((url) => {
      if (url.includes('/settings/public')) {
        return { status: 200, body: okEnvelope({ 'oauth.google.enabled': true }) };
      }
      return undefined;
    });
    renderAuth(<LoginForm />);
    const link = await screen.findByRole('link', { name: 'ورود با گوگل' });
    expect(link.getAttribute('href')).toBe(
      `${API}/auth/google/start?next=${encodeURIComponent('/')}`,
    );
  });

  it('hides the Google button while the setting is disabled', async () => {
    stubFetch((url) =>
      url.includes('/settings/public')
        ? { status: 200, body: okEnvelope({ 'oauth.google.enabled': false }) }
        : undefined,
    );
    renderAuth(<LoginForm />);
    await act(async () => {});
    expect(screen.queryByRole('link', { name: 'ورود با گوگل' })).not.toBeInTheDocument();
  });
});
