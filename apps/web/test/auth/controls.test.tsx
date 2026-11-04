// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { LanguageSwitcher } from '../../src/components/layout/language-switcher';
import { ThemeModeToggle } from '../../src/components/layout/theme-mode-toggle';
import { SiteFooter } from '../../src/components/layout/site-footer';
import { MobileNav } from '../../src/components/layout/mobile-nav';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { en, fa } from './messages';

// Stub next-intl/navigation.
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

const switchLocale = vi.fn();
vi.mock('../../src/i18n/hooks', () => ({
  useLanguages: () => ({
    data: [
      { code: 'fa', nameNative: 'فارسی', nameEn: 'Persian' },
      { code: 'en', nameNative: 'English', nameEn: 'English' },
    ],
  }),
  useSwitchLocale: () => switchLocale,
}));

function withProviders(node: React.ReactNode, locale: 'en' | 'fa' = 'en') {
  cleanup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
        <AuthProvider initialUser={null}>{node}</AuthProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('LanguageSwitcher (F1.7)', () => {
  beforeEach(() => {
    switchLocale.mockReset();
    document.documentElement.dir = 'ltr';
  });

  it('lists active languages with native names', () => {
    withProviders(<LanguageSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    // Radix dropdowns open on pointerdown.
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(screen.getByText('فارسی')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('calls switchLocale when a language is selected', () => {
    withProviders(<LanguageSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(screen.getByText('فارسی'));
    expect(switchLocale).toHaveBeenCalledWith('fa');
  });
});

describe('ThemeModeToggle (F1.7)', () => {
  beforeEach(() => {
    document.documentElement.dir = 'ltr';
    document.documentElement.setAttribute('data-mode', 'light');
    document.documentElement.setAttribute('data-mode-pref', 'light');
  });

  it('writes the mode cookie when selecting dark', () => {
    const { container } = withProviders(<ThemeModeToggle />);
    // The toggle renders a disabled placeholder until mounted; flush the effect.
    const buttons = container.querySelectorAll('button');
    const trigger = Array.from(buttons).find(
      (b) => b.getAttribute('aria-label') === 'Toggle theme' && !b.hasAttribute('disabled'),
    );
    expect(trigger).toBeTruthy();
    fireEvent.pointerDown(trigger!, { button: 0 });
    fireEvent.click(screen.getByText('Dark'));
    // The cookie was written by useThemeMode.
    expect(document.cookie).toContain('mode=dark');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });
});

describe('SiteFooter (F1.7)', () => {
  it('renders the copyright year (en locale → Gregorian)', () => {
    withProviders(<SiteFooter />, 'en');
    // The year should be the current Gregorian year.
    const year = String(new Date().getFullYear());
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
  });

  it('fa locale renders Persian brand name', () => {
    withProviders(<SiteFooter />, 'fa');
    expect(screen.getByText('ایکس‌برند')).toBeInTheDocument();
  });
});

describe('MobileNav (F1.7)', () => {
  it('renders the mobile tab items', () => {
    const { container } = withProviders(<MobileNav />);
    const links = container.querySelectorAll('a');
    // Home, Search (mobile) + Account.
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('hides on scroll down and shows on scroll up', () => {
    // Make rAF synchronous so the scroll handler runs immediately.
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    const { container } = withProviders(<MobileNav />);
    const nav = container.querySelector('nav')!;
    expect(nav.className).toContain('translate-y-0');

    // Scroll down past the threshold.
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 200 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(nav.className).toContain('translate-y-full');

    // Scroll up.
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 100 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(nav.className).toContain('translate-y-0');

    window.requestAnimationFrame = origRaf;
  });
});

describe('F1.7 — axe', () => {
  it('SiteFooter is axe-clean', async () => {
    const { container } = withProviders(<SiteFooter />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('MobileNav is axe-clean', async () => {
    const { container } = withProviders(<MobileNav />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
