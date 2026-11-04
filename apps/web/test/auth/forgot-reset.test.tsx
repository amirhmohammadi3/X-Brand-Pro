// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { ForgotForm, RESET_IDENTIFIER_KEY } from '../../src/components/auth/forgot-form';
import { ResetForm } from '../../src/components/auth/reset-form';
import { ToastProvider } from '../../src/components/ui/toast';
import { fa, okEnvelope, renderAuth, routerReplace, stubFetch } from './helpers';

// Hoisted mock — see login-form.test.tsx for the rationale.
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

beforeEach(() => {
  routerReplace.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ForgotForm (F1.8) — generic confirmation screen', () => {
  it('requires an identifier before submitting', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAuth(<ForgotForm />);
    fireEvent.click(screen.getByRole('button', { name: 'ارسال کد بازیابی' }));
    await act(async () => {});
    expect(screen.getByText('این فیلد الزامی است.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reveals whether the account exists and carries the identifier onward', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/auth/password/forgot')
        ? { status: 200, body: okEnvelope({ ok: true }) }
        : undefined,
    );
    renderAuth(<ForgotForm />);
    fireEvent.change(screen.getByLabelText(/نام کاربری، ایمیل یا شماره موبایل/), {
      target: { value: 'ghost-or-real@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ارسال کد بازیابی' }));
    expect(await screen.findByText('کد بازیابی ارسال شد')).toBeInTheDocument();
    expect(
      screen.getByText(
        'اگر حسابی با این مشخصات موجود باشد، کد بازیابی برایتان ارسال شده است. پوشهٔ هرزنامه را هم بررسی کنید.',
      ),
    ).toBeInTheDocument();

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${API}/auth/password/forgot`);
    expect(sessionStorage.getItem(RESET_IDENTIFIER_KEY)).toBe('ghost-or-real@example.com');

    const link = screen.getByRole('link', { name: 'ادامه و تعیین گذرواژهٔ جدید' });
    expect(link.getAttribute('href')).toBe(
      `/reset-password?identifier=${encodeURIComponent('ghost-or-real@example.com')}`,
    );
  });
});

function renderResetWithToast(node: React.ReactNode) {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={fa}>
        <ToastProvider>{node}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('ResetForm (F1.8)', () => {
  it('prefills the identifier from the query and resets the password with a toast', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('/auth/password/reset')) return { status: 204, body: null };
      return undefined;
    });
    renderResetWithToast(<ResetForm initialIdentifier="ali@example.com" />);

    const identifier = screen.getByLabelText(
      /نام کاربری، ایمیل یا شماره موبایل/,
    ) as HTMLInputElement;
    expect(identifier.value).toBe('ali@example.com');

    const cells = screen.getAllByRole('textbox');
    // The identifier input is the first textbox; the OTP cells follow.
    const codeCells = cells.slice(1);
    const code = '246813';
    for (let i = 0; i < code.length; i += 1) {
      const cell = codeCells[i];
      if (cell === undefined) break;
      fireEvent.change(cell, { target: { value: code[i] } });
    }
    fireEvent.change(screen.getByLabelText(/گذرواژهٔ جدید/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تغییر گذرواژه' }));

    expect(
      await screen.findByText('گذرواژه تغییر کرد؛ با گذرواژهٔ جدید وارد شوید.'),
    ).toBeInTheDocument();
    expect(routerReplace).toHaveBeenCalledWith('/login');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${API}/auth/password/reset`);
  });

  it('falls back to sessionStorage and then to the missing-identifier note', async () => {
    stubFetch(() => undefined);
    renderResetWithToast(<ResetForm />);
    expect(
      await screen.findByText(
        'برای تعیین گذرواژهٔ جدید، ابتدا از صفحهٔ بازیابی گذرواژه کد بگیرید.',
      ),
    ).toBeInTheDocument();
  });

  it('restores the identifier from sessionStorage when the query is empty', async () => {
    stubFetch(() => undefined);
    sessionStorage.setItem(RESET_IDENTIFIER_KEY, '09123456789');
    renderResetWithToast(<ResetForm />);
    const identifier = (await screen.findByLabelText(
      /نام کاربری، ایمیل یا شماره موبایل/,
    )) as HTMLInputElement;
    await act(async () => {});
    expect(identifier.value).toBe('09123456789');
  });
});
