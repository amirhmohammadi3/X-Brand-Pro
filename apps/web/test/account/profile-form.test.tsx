// @vitest-environment jsdom
/**
 * ProfileForm component tests (F1.9). Covers:
 *  - client-side validation (empty display name → validation.required),
 *  - server error mapping (PATCH /users/me 500 → errors.internal_error),
 *  - username cooldown error rendering with a Jalali-formatted retry date.
 *
 * Avatar upload progress/failure states need XHR mocking and are deferred
 * (see docs/PROGRESS.md Follow-ups); the uploadMedia envelope/error logic is
 * mirrored from apiFetch so it is exercised by the api-client spec instead.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { ToastProvider } from '../../src/components/ui/toast';
import { ProfileForm } from '../../src/components/account/profile-form';
import {
  makeUser,
  okEnvelope,
  errorEnvelope,
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
    usePathname: () => '/fa/account/profile',
    useRouter: () => ({ push: routerPush, replace: routerReplace }),
  };
});

function renderProfile(handler: RouteHandler, userOverrides: Parameters<typeof makeUser>[0] = {}) {
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
            <ProfileForm />
          </ToastProvider>
        </AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { fetchMock, user };
}

const meHandler: RouteHandler = (url) => {
  if (url.endsWith('/auth/me'))
    return { status: 200, body: okEnvelope(makeUser({ displayName: 'Tester' })) };
  return undefined;
};

beforeEach(() => {
  routerReplace.mockReset();
  routerPush.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('ProfileForm (F1.9)', () => {
  it('rejects an empty display name with the validation.required message', async () => {
    renderProfile(meHandler);
    const nameInput = await screen.findByLabelText(/نام نمایشی/);
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /ذخیره/ }));
    await screen.findByText('این فیلد الزامی است.');
  });

  it('maps a server error on PATCH /users/me to the messageKey', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/me'))
        return { status: 200, body: okEnvelope(makeUser({ displayName: 'Tester' })) };
      if (url.endsWith('/users/me') && method === 'PATCH') {
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      }
      return undefined;
    };
    renderProfile(handler);
    const nameInput = await screen.findByLabelText(/نام نمایشی/);
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } });
    fireEvent.click(screen.getByRole('button', { name: /ذخیره/ }));
    // 500 → useApiMutation retries once (5xx), so allow time for the retry+reject.
    await screen.findByText('خطایی از سمت ما رخ داد؛ دوباره تلاش کنید.', {}, { timeout: 5000 });
  });

  it('renders the username cooldown error with a Jalali retry date in fa', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/me'))
        return { status: 200, body: okEnvelope(makeUser({ displayName: 'Tester' })) };
      if (url.endsWith('/users/me/username') && method === 'POST') {
        // The form keys the cooldown branch off `details.retryAt` regardless of
        // the code; CONFLICT is a real ErrorCode enum value that carries the
        // retryAt detail. The exact server-side cooldown code is a Follow-up
        // (confirm against a live DB once B1.10 changeUsername is exercised).
        return {
          status: 409,
          body: errorEnvelope('CONFLICT', 'cooldown', { retryAt: '2026-12-01T00:00:00Z' }),
        };
      }
      return undefined;
    };
    renderProfile(handler, { username: 'tester' });

    // Open the username-change modal.
    fireEvent.click(await screen.findByRole('button', { name: /^تغییر$/ }));
    const dialog = await screen.findByRole('dialog');

    // The modal's username input, scoped to the dialog (the section heading
    // «نام کاربری» outside the modal would otherwise shadow the label match).
    const usernameInput = within(dialog).getByRole('textbox');
    fireEvent.change(usernameInput, { target: { value: 'newname' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /تغییر نام کاربری/ }));

    // The cooldown message renders with the Jalali date (1405-09-10 → آذر).
    const cooldownNode = await within(dialog).findByText((content) =>
      content.includes('امکان تغییر مجدد'),
    );
    expect(cooldownNode.textContent ?? '').toMatch(/آذر/);
    await waitFor(() => expect(routerReplace).not.toHaveBeenCalled());
  });
});
