// @vitest-environment jsdom
/**
 * UsersAdmin component tests (F2.5). Covered: registry rows + badges, the
 * admin-only actions column (hidden for moderators), self-action guards,
 * the role-change PATCH and the ban POST with a mandatory reason, and the
 * server search `q` param.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { UsersAdmin } from '../../src/app/[locale]/(admin)/admin/users/users-admin';
import { makeUser, okEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';
import type { AdminUser } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/users', useRouter: () => ({}) };
});

const ME_ID = '00000000-0000-4000-8000-0000000000ff';

function adminRow(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: '00000000-0000-4000-8000-000000000011',
    username: 'sara',
    email: 'sara@example.com',
    phone: null,
    role: 'user',
    status: 'active',
    displayName: 'سارا',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    bio: null,
    locale: 'fa',
    emailVerified: true,
    phoneVerified: false,
    bannedReason: null,
    bannedUntil: null,
    lastLoginAt: '2026-11-08T10:00:00Z',
    deletedAt: null,
    sessionsCount: 2,
    ...overrides,
  };
}

const SARA = adminRow();
const BLOCKED = adminRow({
  id: '00000000-0000-4000-8000-000000000022',
  username: 'reza',
  displayName: 'رضا',
  email: null,
  phone: '+989121234567',
  status: 'blocked',
  bannedReason: 'تخلف از قوانین',
});
const SELF = adminRow({
  id: ME_ID,
  username: 'boss',
  role: 'admin',
  displayName: 'مدیر',
  email: 'boss@example.com',
});

function renderUsers(meRole: 'admin' | 'moderator' = 'admin') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <AuthProvider
          initialUser={makeUser({ id: ME_ID, role: meRole, username: 'boss' })}
          initialApiError={false}
        >
          <ToastProvider>
            <UsersAdmin />
          </ToastProvider>
        </AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function stubUsers(extra?: RouteHandler) {
  stubFetch((url, init) => {
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url.includes('/admin/users')) {
      return {
        status: 200,
        body: okEnvelope({
          items: [SARA, BLOCKED, SELF],
          meta: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
        }),
      };
    }
    return undefined;
  });
}

describe('UsersAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders rows with role/status badges and ban reason', async () => {
    stubUsers();
    renderUsers();
    const all = await screen.findAllByText('سارا');
    // eslint-disable-next-line no-console
    console.log('SARA_COUNT', all.length);
    // eslint-disable-next-line no-console
    console.log(
      'TABLES',
      document.querySelectorAll('table').length,
      'TBODIES',
      document.querySelectorAll('tbody').length,
      'ROWS',
      document.querySelectorAll('tbody tr').length,
    );
     
    expect(all.length).toBeGreaterThan(0);
    expect(screen.getByText('تخلف از قوانین')).toBeInTheDocument();
    expect(screen.getAllByText('کاربر').length).toBeGreaterThanOrEqual(2); // role badges
    expect(screen.getByText('مسدود')).toBeInTheDocument();
  });

  it('hides the actions column from moderators (users.manage mirror)', async () => {
    stubUsers();
    renderUsers('moderator');
    expect(await screen.findByText('سارا')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تغییر نقش' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'مسدودسازی' })).toBeNull();
  });

  it('disables actions on the admin’s own row', async () => {
    stubUsers();
    renderUsers();
    const row = (await screen.findByText('@boss')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'تغییر نقش' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'خروج از همه نشست‌ها' })).toBeDisabled();
  });

  it('changes a role through the modal with the PATCH body', async () => {
    const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
    stubUsers((url, init) => {
      if (url.includes('/role') && init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        return { status: 200, body: okEnvelope({ ...SARA, role: 'moderator' }) };
      }
      return undefined;
    });
    renderUsers();
    const row = (await screen.findByText('@sara')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'تغییر نقش' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/نقش/), { target: { value: 'moderator' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]?.body).toEqual({ role: 'moderator' });
  });

  it('bans a user with a mandatory reason and blocks a too-short one', async () => {
    const bans: Array<Record<string, unknown>> = [];
    stubUsers((url, init) => {
      if (url.includes('/ban') && init?.method === 'POST') {
        bans.push(JSON.parse(String(init.body)));
        return {
          status: 200,
          body: okEnvelope({ ...SARA, status: 'blocked', bannedReason: 'اسپم تبلیغاتی' }),
        };
      }
      return undefined;
    });
    renderUsers();
    const row = (await screen.findByText('@sara')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'مسدودسازی' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/دلیل مسدودسازی/), { target: { value: 'ab' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'مسدودسازی' }));
    expect(await screen.findByText('دلیل باید حداقل ۳ نویسه باشد.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/دلیل مسدودسازی/), {
      target: { value: 'اسپم تبلیغاتی' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'مسدودسازی' }));
    await waitFor(() => expect(bans).toHaveLength(1));
    expect(bans[0]).toEqual({ reason: 'اسپم تبلیغاتی' });
  });

  it('search re-queries the server with q', async () => {
    const urls: string[] = [];
    stubUsers((url) => {
      if (url.includes('/admin/users')) {
        urls.push(url);
        return {
          status: 200,
          body: okEnvelope({
            items: [SARA],
            meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
        };
      }
      return undefined;
    });
    renderUsers();
    await screen.findByText('سارا');
    const search = screen.getByLabelText(/جست‌وجوی کاربر/);
    fireEvent.change(search, { target: { value: 'sara' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(urls.some((u) => u.includes('q=sara'))).toBe(true));
  });
});
