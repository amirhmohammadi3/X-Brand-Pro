// @vitest-environment jsdom
/**
 * Accessibility contract for the F1.8 auth pages (DESIGN.md section 9):
 * every auth surface passes axe in BOTH locales (fa RTL + en LTR).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { axe } from 'jest-axe';
import { LoginForm } from '../../src/components/auth/login-form';
import { RegisterForm } from '../../src/components/auth/register-form';
import { ForgotForm } from '../../src/components/auth/forgot-form';
import { ResetForm } from '../../src/components/auth/reset-form';
import { VerifyClient } from '../../src/components/auth/verify-client';
import { VerificationBanner } from '../../src/components/auth/verification-banner';
import { LoginRequiredPrompt } from '../../src/components/auth/login-required-prompt';
import { ToastProvider } from '../../src/components/ui/toast';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { makeUser, renderAuth, stubFetch } from './helpers';

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

function makeUserForLocale(emailVerified: boolean, phoneVerified: boolean) {
  return makeUser({
    email: 'tester@example.com',
    phone: '+989123456789',
    emailVerified,
    phoneVerified,
  });
}

const SURFACES: Record<string, () => React.ReactNode> = {
  login: () => <LoginForm initialNext="/account" />,
  register: () => <RegisterForm />,
  forgot: () => <ForgotForm />,
  // The (auth) layout mounts the toast provider; mirror that here.
  reset: () => (
    <ToastProvider>
      <ResetForm initialIdentifier="tester@example.com" />
    </ToastProvider>
  ),
  verify: () => <VerifyClient user={makeUserForLocale(false, false)} />,
  banner: () => (
    <AuthProvider initialUser={makeUserForLocale(false, false)}>
      <VerificationBanner />
    </AuthProvider>
  ),
  'login-prompt': () => <LoginRequiredPrompt open onOpenChange={() => undefined} />,
};

describe('auth pages axe (F1.8)', () => {
  it.each(Object.entries(SURFACES))(
    '%s passes axe in fa (RTL)',
    async (_surface, renderSurface) => {
      stubFetch(() => ({ status: 200, body: { ok: true, data: {} } }));
      renderAuth(<main>{renderSurface()}</main>, { locale: 'fa' });
      // The modal portals to document.body — scan the whole body everywhere.
      const results = await axe(document.body);
      expect(results.violations).toEqual([]);
    },
  );

  it.each(Object.entries(SURFACES))(
    '%s passes axe in en (LTR)',
    async (_surface, renderSurface) => {
      stubFetch(() => ({ status: 200, body: { ok: true, data: {} } }));
      renderAuth(<main>{renderSurface()}</main>, { locale: 'en' });
      const results = await axe(document.body);
      expect(results.violations).toEqual([]);
    },
  );

  it('unmounts cleanly between surfaces', () => {
    cleanup();
    expect(document.body.textContent).toBe('');
  });
});
