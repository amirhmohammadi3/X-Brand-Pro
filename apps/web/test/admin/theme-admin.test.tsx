// @vitest-environment jsdom
/**
 * ThemeAdmin component tests (F2.4). Covered: pack cards with light/dark
 * swatch previews + the active badge, and the activate flow PUTting the
 * packId behind a confirmation.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { ThemeAdmin } from '../../src/app/[locale]/(admin)/admin/theme/theme-admin';
import { okEnvelope, stubFetch } from '../auth/helpers';
import type { ThemePreview } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/theme', useRouter: () => ({}) };
});

const MODERN: ThemePreview = {
  id: 'modern',
  names: { fa: 'مدرن', en: 'Modern' },
  isActive: true,
  version: 3,
  preview: {
    light: ['#ffffff', '#0a0a0a', '#2563eb', '#f1f5f9', '#16a34a'],
    dark: ['#0a0a0a', '#fafafa', '#3b82f6', '#1e293b', '#22c55e'],
  },
};

const LUXE: ThemePreview = {
  id: 'luxe',
  names: { fa: 'لوکس', en: 'Luxe' },
  isActive: false,
  version: 1,
  preview: {
    light: ['#fffbeb', '#1c1917', '#b45309', '#fef3c7', '#65a30d'],
    dark: ['#1c1917', '#fef3c7', '#f59e0b', '#292524', '#84cc16'],
  },
};

function renderTheme() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <ThemeAdmin />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('ThemeAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders pack cards with previews and the active badge', async () => {
    stubFetch((url) =>
      url.includes('/theme/packs')
        ? { status: 200, body: okEnvelope({ items: [MODERN, LUXE] }) }
        : undefined,
    );
    renderTheme();
    const modernCard = (await screen.findByText('مدرن')).closest('li') as HTMLElement;
    expect(screen.getByText('لوکس')).toBeInTheDocument();
    // The active card shows the badge AND the disabled «فعال» button.
    expect(within(modernCard).getAllByText('فعال').length).toBeGreaterThan(0);
    expect(within(modernCard).getByRole('button', { name: 'فعال' })).toBeDisabled();
    // 5 light + 5 dark swatches per pack
    expect(screen.getAllByRole('img').length).toBe(4);
  });

  it('activates a pack through confirmation with the packId body', async () => {
    const puts: Array<Record<string, unknown>> = [];
    stubFetch((url, init) => {
      if (url.includes('/admin/theme/active') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return {
          status: 200,
          body: okEnvelope({
            pack: { id: 'luxe', names: LUXE.names, tokens: {} },
            version: 'abc12345',
          }),
        };
      }
      if (url.includes('/theme/packs')) {
        return { status: 200, body: okEnvelope({ items: [MODERN, LUXE] }) };
      }
      return undefined;
    });
    renderTheme();
    const card = (await screen.findByText('لوکس')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'فعال‌سازی' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'فعال‌سازی' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const put = puts[0];
    expect(put).toBeDefined();
    if (put === undefined) return;
    expect(put.packId).toBe('luxe');
  });
});
