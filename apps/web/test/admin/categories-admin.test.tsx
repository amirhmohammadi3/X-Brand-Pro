// @vitest-environment jsdom
/**
 * CategoriesAdmin component tests (F2.2). Covered: the depth-first tree
 * ordering (parent row before its child), the subcategory create flow, and
 * the B2.3 amenity mapping dialog (GET current mapping → toggle → PUT).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { CategoriesAdmin } from '../../src/app/[locale]/(admin)/admin/categories/categories-admin';
import { okEnvelope, stubFetch } from '../auth/helpers';
import type { AdminCategory, Amenity } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/categories', useRouter: () => ({}) };
});

const RESTAURANT: AdminCategory = {
  id: '00000000-0000-4000-8000-0000000000c1',
  parentId: null,
  slug: 'restaurant',
  name: { fa: 'رستوران', en: 'Restaurant' },
  description: null,
  icon: 'utensils',
  color: null,
  kind: 'menu',
  supportsReservation: true,
  isActive: true,
  sortOrder: 1,
  childCount: 1,
  businessCount: 2,
};

const ITALIAN: AdminCategory = {
  ...RESTAURANT,
  id: '00000000-0000-4000-8000-0000000000c2',
  parentId: RESTAURANT.id,
  slug: 'italian',
  name: { fa: 'ایتالیایی' },
  icon: 'coffee',
  kind: 'menu',
  supportsReservation: false,
  childCount: 0,
  businessCount: 1,
};

const WIFI: Amenity = {
  id: '00000000-0000-4000-8000-0000000000a1',
  slug: 'wifi',
  name: { fa: 'وای‌فای', en: 'Wi-Fi' },
  icon: 'wifi',
  group: 'general',
  isActive: true,
  sortOrder: 1,
};

const PARKING: Amenity = {
  ...WIFI,
  id: '00000000-0000-4000-8000-0000000000a2',
  slug: 'parking',
  name: { fa: 'پارکینگ' },
  icon: 'parking-square',
};

function renderCategories() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <CategoriesAdmin />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function stubCatalog(
  handler: (
    url: string,
    init: RequestInit | undefined,
  ) => { status: number; body: unknown } | undefined,
) {
  stubFetch((url, init) => {
    if (url.includes('/admin/categories')) return handler(url, init);
    if (url.includes('/admin/amenities')) {
      return { status: 200, body: okEnvelope({ items: [WIFI, PARKING] }) };
    }
    return undefined;
  });
}

describe('CategoriesAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the tree parent-first with the child row after its root', async () => {
    stubCatalog(() => ({ status: 200, body: okEnvelope({ items: [ITALIAN, RESTAURANT] }) }));
    renderCategories();
    const restaurant = await screen.findByText('رستوران');
    const italian = screen.getByText('ایتالیایی');
    // Document order: the root appears before its child regardless of the
    // API's item order.
    expect(
      restaurant.compareDocumentPosition(italian) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('creates a subcategory under a root', async () => {
    const posts: Array<Record<string, unknown>> = [];
    stubCatalog((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: okEnvelope(ITALIAN) };
      }
      return { status: 200, body: okEnvelope({ items: [RESTAURANT] }) };
    });
    renderCategories();
    const row = (await screen.findByText('رستوران')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'زیردسته' }));
    fireEvent.change(screen.getByLabelText(/نام \(فارسی\)/), { target: { value: 'کافه' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const first = posts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.name).toEqual({ fa: 'کافه' });
    expect(first.parentId).toBe(RESTAURANT.id);
  });

  it('maps amenities onto a category through the dialog', async () => {
    const puts: Array<Record<string, unknown>> = [];
    stubCatalog((url, init) => {
      if (url.includes('/amenities') && url.includes(RESTAURANT.id)) {
        if ((init?.method ?? 'GET') === 'GET') {
          return { status: 200, body: okEnvelope({ items: [WIFI.id] }) };
        }
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init?.body)));
          return { status: 200, body: okEnvelope({ ok: true }) };
        }
      }
      return { status: 200, body: okEnvelope({ items: [RESTAURANT, ITALIAN] }) };
    });
    renderCategories();
    const row = (await screen.findByText('رستوران')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'امکانات' }));
    // Both amenities listed; Wi-Fi pre-checked from the current mapping.
    const wifi = await screen.findByRole('checkbox', { name: /وای‌فای/ });
    const parking = screen.getByRole('checkbox', { name: /پارکینگ/ });
    expect(wifi).toBeChecked();
    expect(parking).not.toBeChecked();
    fireEvent.click(parking);
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const put = puts[0];
    expect(put).toBeDefined();
    if (put === undefined) return;
    expect(put.amenityIds).toEqual([WIFI.id, PARKING.id]);
  });
});
