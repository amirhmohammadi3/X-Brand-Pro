// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { RegisterForm } from '../../src/components/auth/register-form';
import { makeUser, okEnvelope, errorEnvelope, renderAuth, stubFetch } from './helpers';

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

const registeredUser = makeUser({ emailVerified: false, phoneVerified: false });

function fillBase(username: string, password: string) {
  // Labels carry the platform's required marker, so match loosely.
  fireEvent.change(screen.getByLabelText(/نام کاربری/), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(/گذرواژه/), { target: { value: password } });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RegisterForm (F1.8) — live username hint', () => {
  it('shows the format requirement while typing and success once valid', () => {
    renderAuth(<RegisterForm />);
    fireEvent.change(screen.getByLabelText(/نام کاربری/), { target: { value: '1ab' } });
    expect(
      screen.getByText(
        '۳ تا ۳۰ نویسه؛ با حرف انگلیسی شروع می‌شود و فقط حروف کوچک، عدد و زیرخط دارد.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/نام کاربری/), { target: { value: 'ali01' } });
    expect(screen.getByText('قالب نام کاربری درست است.')).toBeInTheDocument();
  });
});

describe('RegisterForm (F1.8) — submit rules', () => {
  it('refuses to submit without accepting the terms and never calls the API', async () => {
    const fetchMock = stubFetch(() => undefined);
    renderAuth(<RegisterForm />);
    fillBase('ali_reza', 'Passw0rd123');
    fireEvent.click(screen.getByRole('button', { name: 'ایجاد حساب' }));
    await act(async () => {});
    expect(screen.getByText('برای ثبت‌نام باید شرایط استفاده را بپذیرید.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid username format client-side', async () => {
    stubFetch(() => undefined);
    renderAuth(<RegisterForm />);
    fillBase('1bad', 'Passw0rd123');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ایجاد حساب' }));
    await act(async () => {});
    expect(
      screen.getByText(
        'نام کاربری باید ۳ تا ۳۰ نویسه باشد و با حرف انگلیسی شروع شود؛ فقط حروف کوچک انگلیسی، عدد و زیرخط مجاز است.',
      ),
    ).toBeInTheDocument();
  });
});

describe('RegisterForm (F1.8) — success and server errors', () => {
  it('registers, seeds the auth cache and shows the verification nudge', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/auth/register')
        ? {
            status: 201,
            body: okEnvelope({ user: registeredUser, accessExpiresAt: '2026-11-04T12:00:00Z' }),
          }
        : undefined,
    );
    const queryClient = renderAuth(<RegisterForm />);
    fillBase('ali_reza', 'Passw0rd123');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ایجاد حساب' }));
    expect(await screen.findByText('حساب شما ساخته شد')).toBeInTheDocument();
    // The nudge banner: both email and phone are unverified.
    expect(screen.getByText('ایمیل یا شماره موبایل شما تأیید نشده است')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'me'])).toMatchObject({ username: 'tester' });

    const [url, init] = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/auth/register'),
    )! as [string, RequestInit];
    expect(url).toContain('/auth/register');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ username: 'ali_reza', password: 'Passw0rd123' });
    expect(body.email).toBeUndefined();
    expect(body.phone).toBeUndefined();
  });

  it('maps a CONFLICT (username taken) onto the username field, checked on submit only', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/auth/register')
        ? { status: 409, body: errorEnvelope('CONFLICT', 'Username already exists') }
        : undefined,
    );
    renderAuth(<RegisterForm />);
    fillBase('ali_reza', 'Passw0rd123');
    // Typing does NOT probe availability.
    fireEvent.change(screen.getByLabelText(/نام کاربری/), { target: { value: 'ali_reza2' } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ایجاد حساب' }));
    expect(await screen.findByText('این نام کاربری قبلاً گرفته شده است.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('links the legal pages in the terms checkbox without building them', () => {
    renderAuth(<RegisterForm />);
    const terms = screen.getByRole('link', { name: 'شرایط استفاده' });
    const privacy = screen.getByRole('link', { name: 'حریم خصوصی' });
    expect(terms.getAttribute('href')).toBe('/p/terms');
    expect(privacy.getAttribute('href')).toBe('/p/privacy');
  });
});
