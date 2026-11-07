// @vitest-environment jsdom
/**
 * SettingsForm component tests (F1.9). Covers the three areas the prompt calls
 * out as testable without a live browser/Docker:
 *  - password section variants: change (account already has a password) and
 *    set (passwordless account), plus the client-side weak-password and
 *    mismatch guards;
 *  - sessions revoke flow with a confirmation modal;
 *  - delete-account typing guard (wrong confirmation text is rejected) and the
 *    success path (clears state + redirects to `/`).
 *
 * axe (both locales × light/dark) and the Playwright `account.spec.ts` need a
 * real browser/Docker and are deferred to docs/PROGRESS.md Follow-ups.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { ToastProvider } from '../../src/components/ui/toast';
import { SettingsForm } from '../../src/components/account/settings-form';
import {
  makeUser,
  okEnvelope,
  stubFetch,
  routerReplace,
  routerPush,
  type RouteHandler,
} from '../auth/helpers';

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
    usePathname: () => '/fa/account/settings',
    useRouter: () => ({ push: routerPush, replace: routerReplace }),
  };
});

const SESSIONS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
    ip: '10.0.0.1',
    createdAt: '2026-11-01T00:00:00Z',
    lastUsedAt: '2026-11-07T10:00:00Z',
    current: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/17',
    ip: '10.0.0.2',
    createdAt: '2026-11-01T00:00:00Z',
    lastUsedAt: '2026-11-06T10:00:00Z',
    current: false,
  },
];

function renderSettings(handler: RouteHandler, userOverrides: Parameters<typeof makeUser>[0] = {}) {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  const user = makeUser({ displayName: 'Tester', ...userOverrides });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <AuthProvider initialUser={user} initialApiError={false}>
          <ToastProvider>
            <SettingsForm />
          </ToastProvider>
        </AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { fetchMock, user };
}

/** Base handler answers the read endpoints every SettingsForm mount fires. */
function baseHandler(user: ReturnType<typeof makeUser>): RouteHandler {
  return (url, init) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/me')) return { status: 200, body: okEnvelope(user) };
    if (url.endsWith('/auth/sessions') && method === 'GET')
      return { status: 200, body: okEnvelope(SESSIONS) };
    if (url.endsWith('/auth/oauth/accounts') && method === 'GET')
      return { status: 200, body: okEnvelope({ accounts: [] }) };
    return undefined;
  };
}

beforeEach(() => {
  routerReplace.mockReset();
  routerPush.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('SettingsForm — password section (F1.9)', () => {
  it('changes the password when the account already has one', async () => {
    const user = makeUser({ hasPassword: true });
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/users/me/password') && method === 'POST')
        return { status: 204, body: null };
      return baseHandler(user)(url, init);
    };
    renderSettings(handler, { hasPassword: true });

    const current = await screen.findByLabelText(/رمز فعلی/);
    const next = screen.getByLabelText(/^رمز جدید/);
    const confirm = screen.getByLabelText(/تکرار رمز جدید/);
    fireEvent.change(current, { target: { value: 'Oldpass123' } });
    fireEvent.change(next, { target: { value: 'Newpass123' } });
    fireEvent.change(confirm, { target: { value: 'Newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /تغییر رمز/ }));

    await screen.findByText(/رمز عبور تغییر کرد/);
  });

  it('rejects a weak new password client-side', async () => {
    const user = makeUser({ hasPassword: true });
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/users/me/password') && method === 'POST')
        throw new Error('password endpoint should not be called for a weak password');
      return baseHandler(user)(url, init);
    };
    const { fetchMock } = renderSettings(handler, { hasPassword: true });

    const next = await screen.findByLabelText(/^رمز جدید/);
    const confirm = screen.getByLabelText(/تکرار رمز جدید/);
    fireEvent.change(next, { target: { value: 'weak' } });
    fireEvent.change(confirm, { target: { value: 'weak' } });
    fireEvent.click(screen.getByRole('button', { name: /تغییر رمز/ }));

    await screen.findByText(/رمز باید حداقل ۸ نویسه/);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/users\/me\/password$/),
      expect.anything(),
    );
  });

  it('rejects a confirmation that does not match the new password', async () => {
    const user = makeUser({ hasPassword: true });
    renderSettings((url, init) => baseHandler(user)(url, init), { hasPassword: true });

    const next = await screen.findByLabelText(/^رمز جدید/);
    const confirm = screen.getByLabelText(/تکرار رمز جدید/);
    fireEvent.change(next, { target: { value: 'Newpass123' } });
    fireEvent.change(confirm, { target: { value: 'Different123' } });
    fireEvent.click(screen.getByRole('button', { name: /تغییر رمز/ }));

    await screen.findByText(/تکرار رمز با رمز جدید مطابقت ندارد/);
  });

  it('sets the first password for a passwordless account (no current field)', async () => {
    const user = makeUser({ hasPassword: false });
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/users/me/password') && method === 'POST')
        return { status: 204, body: null };
      return baseHandler(user)(url, init);
    };
    renderSettings(handler, { hasPassword: false });

    // The "set password" intro and the absent current-password field.
    await screen.findByText(/حساب شما رمز عبور ندارد/);
    expect(screen.queryByLabelText(/رمز فعلی/)).toBeNull();

    const next = screen.getByLabelText(/^رمز جدید/);
    const confirm = screen.getByLabelText(/تکرار رمز جدید/);
    fireEvent.change(next, { target: { value: 'Firstpass1' } });
    fireEvent.change(confirm, { target: { value: 'Firstpass1' } });
    fireEvent.click(screen.getByRole('button', { name: /تنظیم رمز/ }));

    await screen.findByText(/رمز عبور تنظیم شد/);
  });
});

describe('SettingsForm — sessions section (F1.9)', () => {
  it('revokes another session through a confirmation modal', async () => {
    const user = makeUser({ hasPassword: true });
    let revokedId: string | null = null;
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && /\/auth\/sessions\/[^/]+$/.test(url)) {
        revokedId = url.slice(url.lastIndexOf('/') + 1);
        return { status: 204, body: null };
      }
      return baseHandler(user)(url, init);
    };
    renderSettings(handler, { hasPassword: true });

    // The non-current session row exposes a "خروج" button; the current one
    // shows the "فعلی" badge instead.
    const revokeButton = await screen.findByRole('button', { name: 'خروج' });
    fireEvent.click(revokeButton);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'خروج' }));

    await screen.findByText(/نشست بسته شد/);
    expect(revokedId).toBe('00000000-0000-0000-0000-000000000002');
  });
});

describe('SettingsForm — delete account (F1.9)', () => {
  it('rejects submission when the typed confirmation is not DELETE', async () => {
    const user = makeUser({ hasPassword: true });
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && url.endsWith('/users/me'))
        throw new Error('delete endpoint should not be called for a wrong confirmation');
      return baseHandler(user)(url, init);
    };
    const { fetchMock } = renderSettings(handler, { hasPassword: true });

    fireEvent.click(await screen.findByRole('button', { name: 'حذف حساب' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/برای تأیید/), {
      target: { value: 'NOTDELETE' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حذف حساب' }));

    await within(dialog).findByText(/عبارت تایپ‌شده با DELETE مطابقت ندارد/);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/users\/me$/),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deletes the account and redirects to / when DELETE + password are supplied', async () => {
    const user = makeUser({ hasPassword: true });
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && url.endsWith('/users/me')) return { status: 204, body: null };
      if (method === 'POST' && url.endsWith('/auth/logout')) return { status: 204, body: null };
      return baseHandler(user)(url, init);
    };
    renderSettings(handler, { hasPassword: true });

    fireEvent.click(await screen.findByRole('button', { name: 'حذف حساب' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/برای تأیید/), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(within(dialog).getByLabelText(/رمز عبور/), {
      target: { value: 'Currentpass1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حذف حساب' }));

    await screen.findByText(/حساب حذف شد/);
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/'));
  });
});
