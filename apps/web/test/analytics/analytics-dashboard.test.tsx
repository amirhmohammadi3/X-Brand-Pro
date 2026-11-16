// @vitest-environment jsdom
/**
 * F7.8 AnalyticsDashboard — the owner analytics view.
 *
 * Covers the four rendering paths against `useBusinessStats` mocked via the
 * `apiFetch` stub (mirrors the F7.6 messages-editor test pattern):
 *  - loading → spinner;
 *  - error → ErrorState;
 *  - empty window (zero events) → EmptyState;
 *  - populated → 5 stat cards + 5 bar-chart SVGs + the funnel.
 *
 * The full `fa` fallback seed feeds NextIntlClientProvider so the Persian
 * copy + digit formatting match production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AnalyticsStatsResult } from '@app/contracts';
import faSeed from '../../src/i18n/fallback/fa.json';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));

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
    usePathname: () => '/fa/dashboard',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderWith(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeStats(overrides: Partial<AnalyticsStatsResult> = {}): AnalyticsStatsResult {
  return {
    businessId: '00000000-0000-4000-8000-000000000001',
    from: '2026-11-01',
    to: '2026-11-03',
    series: [
      { date: '2026-11-01', type: 'business_view', count: 10 },
      { date: '2026-11-02', type: 'business_view', count: 20 },
      { date: '2026-11-03', type: 'business_view', count: 5 },
      { date: '2026-11-01', type: 'call_click', count: 2 },
    ],
    totals: {
      business_view: 35,
      call_click: 2,
      direction_click: 0,
      share_click: 0,
      impression: 0,
    },
    ...overrides,
  };
}

describe('AnalyticsDashboard (F7.8)', () => {
  beforeEach(() => apiFetchMock.mockReset());
  afterEach(() => cleanup());

  it('renders the loading spinner while stats are pending', async () => {
    // A query that never resolves keeps the dashboard in the isPending state.
    // We use a controlled promise so the test never hangs on a stuck fetch.
    let _resolve!: (v: { data: AnalyticsStatsResult }) => void;
    apiFetchMock.mockReturnValueOnce(new Promise((r) => { _resolve = r; }));
    const { AnalyticsDashboard } = await import('../../src/components/analytics/analytics-dashboard');
    renderWith(<AnalyticsDashboard businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/analytics/business/b1/stats',
      expect.anything(),
      expect.objectContaining({ query: expect.any(Object) }),
    );
    // Release the promise so the test runner can tear down cleanly.
    _resolve({ data: makeStats() });
  });

  it('renders the error state when the load fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'));
    const { AnalyticsDashboard } = await import('../../src/components/analytics/analytics-dashboard');
    renderWith(<AnalyticsDashboard businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('بارگذاری آمار ناموفق بود.')).toBeTruthy();
    });
  });

  it('renders the empty state when the window has zero events', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: makeStats({ series: [], totals: { business_view: 0, call_click: 0, direction_click: 0, share_click: 0, impression: 0 } }) });
    const { AnalyticsDashboard } = await import('../../src/components/analytics/analytics-dashboard');
    renderWith(<AnalyticsDashboard businessId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('هنوز داده‌ای ثبت نشده')).toBeTruthy();
    });
    expect(screen.queryByTestId('analytics-funnel')).toBeNull();
  });

  it('renders the stat cards + bar charts + funnel for a populated window', async () => {
    apiFetchMock.mockResolvedValueOnce({ data: makeStats() });
    const { AnalyticsDashboard } = await import('../../src/components/analytics/analytics-dashboard');
    renderWith(<AnalyticsDashboard businessId="b1" />);

    // 5 stat cards (one per event type) — the totals carry Persian digits.
    await waitFor(() => {
      expect(screen.getAllByTestId('analytics-chart-card')).toHaveLength(5);
    });
    // 5 bar charts (one per event type) — the SVGs render even for zero-data types.
    expect(screen.getAllByTestId('analytics-bar-chart')).toHaveLength(5);
    // The funnel has 4 stages (view → call → direction → share; impression excluded).
    const stages = screen.getAllByTestId('analytics-funnel-stage');
    expect(stages).toHaveLength(4);
    // The window label echoes the API's resolved from/to.
    expect(screen.getByTestId('analytics-window').textContent).toContain('2026-11-01');
    expect(screen.getByTestId('analytics-window').textContent).toContain('2026-11-03');
  });

  it('renders the three range presets as selectable tabs', async () => {
    apiFetchMock.mockResolvedValue({ data: makeStats() });
    const { AnalyticsDashboard } = await import('../../src/components/analytics/analytics-dashboard');
    renderWith(<AnalyticsDashboard businessId="b1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('analytics-chart-card')).toHaveLength(5);
    });
    // The default (30d) is the active tab; the 7d and 90d tabs are present too.
    const tabs = screen.getAllByRole('tab');
    const labels = tabs.map((t) => t.textContent);
    expect(labels).toContain('۷ روز');
    expect(labels).toContain('۳۰ روز');
    expect(labels).toContain('۹۰ روز');
    // The 30d tab is the selected one (aria-selected=true) by default.
    const thirty = tabs.find((t) => t.textContent === '۳۰ روز')!;
    expect(thirty.getAttribute('aria-selected')).toBe('true');
  });
});
