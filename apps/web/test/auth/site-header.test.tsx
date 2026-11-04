// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SiteHeader } from '../../src/components/layout/site-header';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { en, fa } from './messages';
import type { CurrentUser } from '@app/contracts';

// Stub next-intl/navigation so Link/usePathname render without a router.
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
    usePathname: () => '/',
    useRouter: () => ({ push: () => {}, replace: () => {} }),
  };
});

// Stub useLanguages so the switcher doesn't hit the network.
vi.mock('../../src/i18n/hooks', () => ({
  useLanguages: () => ({
    data: [
      { code: 'fa', nameNative: 'فارسی', nameEn: 'Persian' },
      { code: 'en', nameNative: 'English', nameEn: 'English' },
    ],
  }),
  useSwitchLocale: () => (_target: string) => {},
}));

function makeUser(role: CurrentUser['role']): CurrentUser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'tester',
    email: 't@e.com',
    phone: null,
    role,
    status: 'active',
    displayName: 'Tester',
    bio: null,
    locale: 'en',
    avatarUrl: null,
    hasPassword: true,
    emailVerified: true,
    phoneVerified: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function renderHeader(initialUser: CurrentUser | null, locale: 'en' | 'fa' = 'en') {
  cleanup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
        <AuthProvider initialUser={initialUser}>
          <SiteHeader />
        </AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('SiteHeader (F1.7)', () => {
  beforeEach(() => {
    document.documentElement.dir = 'ltr';
  });

  it('anonymous: shows login and register buttons', () => {
    renderHeader(null);
    expect(screen.getByText('Log in')).toBeInTheDocument();
    expect(screen.getByText('Register')).toBeInTheDocument();
    // Public nav items render.
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('does not show dashboard/admin nav for anonymous', () => {
    renderHeader(null);
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('authenticated user: no login/register buttons; nav shows account-relevant items', () => {
    renderHeader(makeUser('user'));
    expect(screen.queryByText('Log in')).toBeNull();
    expect(screen.getByText('Home')).toBeInTheDocument();
    // 'bookings' is visible for the user role.
    expect(screen.getByText('Bookings')).toBeInTheDocument();
  });

  it('owner sees dashboard nav but not admin', () => {
    renderHeader(makeUser('owner'));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('admin sees both dashboard and admin nav', () => {
    renderHeader(makeUser('admin'));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders the brand name', () => {
    renderHeader(null);
    expect(screen.getByText('X-Brand')).toBeInTheDocument();
  });

  it('fa locale renders Persian brand name', () => {
    renderHeader(null, 'fa');
    expect(screen.getByText('ایکس‌برند')).toBeInTheDocument();
  });
});
