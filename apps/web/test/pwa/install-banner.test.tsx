// @vitest-environment jsdom
/**
 * InstallBanner component tests (F5.4). Covers:
 *  - already in standalone mode → renders NOTHING (no banner needed);
 *  - iOS Safari (no programmatic prompt) → renders the share-sheet guidance;
 *  - `beforeinstallprompt` fired → renders the install CTA and clicking it
 *    calls `event.prompt()` and resolves with the user's choice.
 *
 * The hook listens to `beforeinstallprompt`/`appinstalled` window events; the
 * test dispatches them with a stubbed `prompt`/`userChoice` so we can assert
 * the CTA calls them.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { InstallBanner } from '../../src/components/pwa/install-banner';

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function renderBanner(): QueryClient {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <InstallBanner />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  // jsdom defaults: no `beforeinstallprompt` capability, not standalone, not iOS.
  vi.stubGlobal('matchMedia', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('InstallBanner (F5.4)', () => {
  it('renders nothing when already in standalone mode', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q === '(display-mode: standalone)',
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );
    renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('renders iOS share-sheet guidance when on iOS Safari without the prompt API', () => {
    // iOS detection: userAgent matches iphone/ipad/ipod + webkit, no CriOS/FxiOS.
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    renderBanner();
    expect(screen.getByRole('region', { name: 'نصب ایکس-برند' })).toBeInTheDocument();
    // iOS path shows the share-sheet body, never the install CTA button.
    expect(screen.getByText(/دکمهٔ اشتراک‌گذاری/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'نصب' })).not.toBeInTheDocument();
  });

  it('renders the install CTA when beforeinstallprompt fires and prompts on click', async () => {
    // Non-iOS userAgent + not standalone → banner is hidden until the event.
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
    });
    renderBanner();
    // Before the event, no banner.
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: 'accepted' as const });
    const evt = new Event('beforeinstallprompt') as PromptEvent;
    evt.prompt = prompt;
    evt.userChoice = userChoice;
    window.dispatchEvent(evt);

    // After the event, the install CTA shows.
    expect(await screen.findByRole('button', { name: 'نصب' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'نصب' }));
    await vi.waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });
  });
});
