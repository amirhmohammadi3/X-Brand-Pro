// @vitest-environment jsdom
/**
 * F7.7 ConsentBanner — the privacy opt-in surface.
 *
 * Covers the three consent states:
 *  - `unknown` (fresh visit): the banner renders with the two buttons;
 *  - clicking «اجازه» calls grantConsent(), the banner unmounts (state→granted);
 *  - clicking «فعلاً نه» calls denyConsent(), the banner unmounts (state→denied);
 *  - a pre-persisted `granted`/`denied` choice: the banner never renders.
 *
 * The full `fa` fallback seed is fed to NextIntlClientProvider so the Persian
 * copy matches production (the banner reads `analytics.consent.*`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import faSeed from '../../src/i18n/fallback/fa.json';

// `@/i18n/navigation`'s Link wraps next/link — stub it as an anchor so the
// rendered href is observable in jsdom (mirrors the F7.6 messages-editor test
// stub). This also avoids next-intl trying to import `next/navigation` at
// test-time (which resolves to a bare specifier the vitest config can't map).
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
    usePathname: () => '/fa',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

function clearStorage() {
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
}

async function renderBanner() {
  // Import AFTER clearing storage so the consent singleton starts fresh.
  vi.resetModules();
  const { ConsentBanner } = await import('../../src/components/analytics/consent-banner');
  return render(
    <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
      <ConsentBanner />
    </NextIntlClientProvider>,
  );
}

describe('ConsentBanner (F7.7)', () => {
  beforeEach(() => {
    clearStorage();
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
  });
  afterEach(() => {
    cleanup();
    clearStorage();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders the banner when no consent choice is persisted', async () => {
    await renderBanner();
    const banner = await screen.findByTestId('analytics-consent-banner');
    expect(banner).toBeTruthy();
    expect(screen.getByText('اجازه می‌دهم')).toBeTruthy();
    expect(screen.getByText('فعلاً نه')).toBeTruthy();
  });

  it('clicking «اجازه» hides the banner and persists granted', async () => {
    await renderBanner();
    const grantBtn = await screen.findByTestId('analytics-consent-grant');
    fireEvent.click(grantBtn);
    expect(window.localStorage.getItem('XBRAND_ANALYTICS_CONSENT')).toBe('granted');
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
  });

  it('clicking «فعلاً نه» hides the banner and persists denied', async () => {
    await renderBanner();
    const denyBtn = await screen.findByTestId('analytics-consent-deny');
    fireEvent.click(denyBtn);
    expect(window.localStorage.getItem('XBRAND_ANALYTICS_CONSENT')).toBe('denied');
    expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
  });

  it('does not render when consent is already granted (persisted)', async () => {
    window.localStorage.setItem('XBRAND_ANALYTICS_CONSENT', 'granted');
    await renderBanner();
    // The banner's effect hydrates the store (reads granted) and unmounts.
    // Use waitFor to allow the state flip to settle.
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
    });
  });

  it('does not render when consent is already denied (persisted)', async () => {
    window.localStorage.setItem('XBRAND_ANALYTICS_CONSENT', 'denied');
    await renderBanner();
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.queryByTestId('analytics-consent-banner')).toBeNull();
    });
  });
});
