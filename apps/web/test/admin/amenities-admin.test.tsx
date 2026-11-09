// @vitest-environment jsdom
/**
 * AmenitiesAdmin component tests (F2.2). Covered: list rendering with the
 * group label and the create flow posting a contract-shaped body.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { AmenitiesAdmin } from '../../src/app/[locale]/(admin)/admin/amenities/amenities-admin';
import { okEnvelope, stubFetch } from '../auth/helpers';
import type { Amenity } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/amenities', useRouter: () => ({}) };
});

const WIFI: Amenity = {
  id: '00000000-0000-4000-8000-0000000000a1',
  slug: 'wifi',
  name: { fa: 'وای‌فای', en: 'Wi-Fi' },
  icon: 'wifi',
  group: 'general',
  isActive: true,
  sortOrder: 1,
};

const CARD: Amenity = {
  ...WIFI,
  id: '00000000-0000-4000-8000-0000000000a3',
  slug: 'card',
  name: { fa: 'کارت بانکی' },
  icon: 'credit-card',
  group: 'payment',
};

function renderAmenities() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <AmenitiesAdmin />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('AmenitiesAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders amenity rows with their group label', async () => {
    stubFetch((url) =>
      url.includes('/admin/amenities')
        ? { status: 200, body: okEnvelope({ items: [WIFI, CARD] }) }
        : undefined,
    );
    renderAmenities();
    expect(await screen.findByText('وای‌فای')).toBeInTheDocument();
    expect(screen.getByText('کارت بانکی')).toBeInTheDocument();
    expect(screen.getByText('عمومی')).toBeInTheDocument();
    expect(screen.getByText('پرداخت')).toBeInTheDocument();
  });

  it('creates an amenity with a contract-shaped body', async () => {
    const posts: Array<Record<string, unknown>> = [];
    stubFetch((url, init) => {
      if (url.includes('/admin/amenities') && (init?.method ?? 'GET') === 'POST') {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: okEnvelope(WIFI) };
      }
      if (url.includes('/admin/amenities')) {
        return { status: 200, body: okEnvelope({ items: [WIFI] }) };
      }
      return undefined;
    });
    renderAmenities();
    fireEvent.click(await screen.findByRole('button', { name: 'افزودن امکان' }));
    fireEvent.change(screen.getByLabelText(/نام \(فارسی\)/), { target: { value: 'فضای باز' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const first = posts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.name).toEqual({ fa: 'فضای باز' });
    expect(first.icon).toBe('wifi');
    expect(first.group).toBe('general');
  });
});
