// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOAuthProviders, useLogout } from '../../src/lib/api/auth';
import { qk } from '../../src/lib/api/qk';
import { makeUser, okEnvelope, errorEnvelope, renderAuth, stubFetch } from './helpers';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { VerificationBanner } from '../../src/components/auth/verification-banner';

// Hoisted mock — see login-form.test.tsx for the rationale.
vi.mock('@/i18n/navigation', async () => {
  const { routerPush, routerReplace } = await import('./helpers');
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
    useRouter: () => ({ push: routerPush, replace: routerReplace }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useOAuthProviders (F1.8)', () => {
  it('reads oauth.google.enabled from the public settings blob', async () => {
    stubFetch((url) =>
      url.includes('/settings/public')
        ? { status: 200, body: okEnvelope({ 'site.locale': 'fa', 'oauth.google.enabled': true }) }
        : undefined,
    );
    const { result } = renderHook(() => useOAuthProviders(), {
      wrapper: wrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.googleEnabled).toBe(true);
  });

  it('counts a missing or invalid flag as disabled', async () => {
    stubFetch((url) =>
      url.includes('/settings/public')
        ? { status: 200, body: okEnvelope({ 'site.locale': 'fa' }) }
        : undefined,
    );
    const { result } = renderHook(() => useOAuthProviders(), {
      wrapper: wrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.googleEnabled).toBe(false);
  });
});

describe('useLogout (F1.8)', () => {
  it('clears the auth cache even when the endpoint fails', async () => {
    stubFetch(() => ({ status: 500, body: errorEnvelope('INTERNAL_ERROR') }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(qk.auth.me(), makeUser());
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });
    await result.current.mutateAsync().catch(() => undefined);
    await waitFor(() => {
      expect(queryClient.getQueryData(qk.auth.me())).toBeNull();
    });
  });
});

describe('VerificationBanner (F1.8)', () => {
  it('shows only while BOTH email and phone are unverified', () => {
    const cases: Array<[boolean, boolean, boolean]> = [
      [false, false, true], // both unverified → visible
      [true, false, false], // email verified → hidden
      [false, true, false], // phone verified → hidden
      [true, true, false],
    ];
    for (const [emailVerified, phoneVerified, shouldShow] of cases) {
      const queryClient = renderAuth(
        <AuthProvider initialUser={makeUser({ emailVerified, phoneVerified })}>
          <VerificationBanner />
        </AuthProvider>,
      );
      const banner = document.querySelector(
        '[aria-label="ایمیل یا شماره موبایل شما تأیید نشده است"]',
      );
      expect(banner !== null).toBe(shouldShow);
      queryClient.clear();
    }
  });

  it('hides for anonymous visitors', () => {
    renderAuth(
      <AuthProvider initialUser={null}>
        <VerificationBanner />
      </AuthProvider>,
    );
    expect(
      document.querySelector('[aria-label="ایمیل یا شماره موبایل شما تأیید نشده است"]'),
    ).toBeNull();
  });
});
