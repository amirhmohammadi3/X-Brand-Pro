// @vitest-environment jsdom
/**
 * FavoritesView component tests (F5.1). Covers:
 *  - the lists index renders with counts + the default badge, auto-selects the
 *    default list and renders its saved businesses as cards;
 *  - creating a named list POSTs /favorites/lists and the new list appears;
 *  - the default list's delete button is disabled (the server would 422);
 *  - removing a saved business DELETEs /favorites/items/:id and toasts.
 *
 * The view drives two queries (lists index + one items page) and a handful of
 * mutations; every fetch is routed through one stubFetch handler so the cache
 * invalidations land on the next refetch and the assertions stay deterministic.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { FavoritesView } from '../../src/components/account/favorites-view';
import { okEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

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
    usePathname: () => '/fa/account/favorites',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const L_DEFAULT = '00000000-0000-0000-0000-0000000000a1';
const L_NAMED = '00000000-0000-0000-0000-0000000000a2';
/** A freshly-created list's id (distinct from L_NAMED so the index never has
 *  two rows with the same testid after the create refetch). */
const L_NEW = '00000000-0000-0000-0000-0000000000a3';
const ITEM_1 = '00000000-0000-0000-0000-0000000000b1';
const ITEM_2 = '00000000-0000-0000-0000-0000000000b2';
const BIZ_1 = '00000000-0000-0000-0000-0000000000c1';
const BIZ_2 = '00000000-0000-0000-0000-0000000000c2';

const listsIndex = {
  lists: [
    {
      id: L_DEFAULT,
      name: 'علاقه‌مندی‌ها',
      isDefault: true,
      itemCount: 2,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    {
      id: L_NAMED,
      name: 'کافه‌های تهران',
      isDefault: false,
      itemCount: 0,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    },
  ],
};

function businessSummary(id: string, slug: string, name: string) {
  return {
    id,
    slug,
    name,
    nameAlt: null,
    // primaryCategory / city ids must be UUIDs (businessPlaceRefSchema).
    primaryCategory: {
      id: '00000000-0000-0000-0000-0000000000d1',
      slug: 'cafe',
      name: { fa: 'کافه', en: 'Cafe' },
    },
    city: {
      id: '00000000-0000-0000-0000-0000000000d2',
      slug: 'tehran',
      name: { fa: 'تهران', en: 'Tehran' },
    },
    neighborhood: null,
    address: 'خیابان ولیعصر',
    location: { lat: 35.7, lng: 51.4 },
    priceLevel: null,
    avgRating: 4.5,
    reviewCount: 12,
    coverUrl: null,
    thumbUrl: null,
    isFeatured: false,
    isClaimed: true,
  };
}

const defaultListItems = {
  items: [
    {
      id: ITEM_1,
      businessId: BIZ_1,
      note: 'صبحانهٔ آخر هفته',
      createdAt: '2026-11-11T00:00:00Z',
      business: businessSummary(BIZ_1, 'cafe-damavand', 'کافه دماوند'),
    },
    {
      id: ITEM_2,
      businessId: BIZ_2,
      note: null,
      createdAt: '2026-11-10T00:00:00Z',
      business: businessSummary(BIZ_2, 'restaurant-ariya', 'رستوران آریا'),
    },
  ],
  meta: { page: 1, pageSize: 12, total: 2, totalPages: 1 },
};

function renderView(handler: RouteHandler) {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>
          <FavoritesView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('FavoritesView (F5.1)', () => {
  it('renders the lists index with counts + default badge and the default list items', async () => {
    const handler: RouteHandler = (url) => {
      if (url.endsWith('/favorites/me')) return { status: 200, body: okEnvelope(listsIndex) };
      if (url.includes(`/favorites/lists/${L_DEFAULT}/items`))
        return { status: 200, body: okEnvelope(defaultListItems) };
      return undefined;
    };
    renderView(handler);

    // Lists index: default list row with the default badge + count, named list row.
    const lists = await screen.findByTestId('favorites-lists');
    const defaultRow = within(lists).getByTestId(`list-row-${L_DEFAULT}`);
    expect(defaultRow).toHaveAttribute('aria-current', 'true');
    expect(within(defaultRow).getByText('پیش‌فرض')).toBeInTheDocument();
    expect(within(defaultRow).getByText('۲')).toBeInTheDocument(); // fa digit for 2

    // Selected list detail: both saved businesses render as cards.
    await screen.findByText('کافه دماوند');
    expect(screen.getByText('رستوران آریا')).toBeInTheDocument();
    // The note on item 1 renders.
    expect(screen.getByText('صبحانهٔ آخر هفته')).toBeInTheDocument();
  });

  it('creates a named list via POST /favorites/lists and surfaces it', async () => {
    let created = false;
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/favorites/me')) {
        // After the create, the index refetch includes the new list.
        if (created) {
          return {
            status: 200,
            body: okEnvelope({
              lists: [
                ...listsIndex.lists,
                {
                  id: L_NEW,
                  name: 'رستوران‌های اصیل',
                  isDefault: false,
                  itemCount: 0,
                  createdAt: '2026-11-12T00:00:00Z',
                  updatedAt: '2026-11-12T00:00:00Z',
                },
              ],
            }),
          };
        }
        return { status: 200, body: okEnvelope(listsIndex) };
      }
      if (url.endsWith('/favorites/lists') && method === 'POST') {
        created = true;
        return {
          status: 201,
          body: okEnvelope({
            id: L_NEW,
            name: 'رستوران‌های اصیل',
            isDefault: false,
            itemCount: 0,
            createdAt: '2026-11-12T00:00:00Z',
            updatedAt: '2026-11-12T00:00:00Z',
          }),
        };
      }
      if (url.includes(`/favorites/lists/${L_DEFAULT}/items`))
        return { status: 200, body: okEnvelope(defaultListItems) };
      if (url.includes(`/favorites/lists/${L_NEW}/items`))
        return {
          status: 200,
          body: okEnvelope({ items: [], meta: { page: 1, pageSize: 12, total: 0, totalPages: 0 } }),
        };
      return undefined;
    };
    renderView(handler);

    const input = await screen.findByLabelText('نام لیست');
    fireEvent.change(input, { target: { value: 'رستوران‌های اصیل' } });
    fireEvent.click(screen.getByRole('button', { name: 'ایجاد لیست' }));

    await screen.findByText(/لیست.*رستوران‌های اصیل.*ساخته شد/);
    // The new list row appears after the index refetch.
    await screen.findByTestId(`list-row-${L_NEW}`);
  });

  it('disables the default list delete button (the server would 422)', async () => {
    const handler: RouteHandler = (url) => {
      if (url.endsWith('/favorites/me')) return { status: 200, body: okEnvelope(listsIndex) };
      if (url.includes(`/favorites/lists/${L_DEFAULT}/items`))
        return { status: 200, body: okEnvelope(defaultListItems) };
      return undefined;
    };
    renderView(handler);

    const lists = await screen.findByTestId('favorites-lists');
    // The delete IconButton for the default list. Scoped to the lists index
    // (not the row button) because the action buttons are siblings of the
    // row-selector button, not its descendants. The default list's delete
    // aria-label «حذف علاقه‌مندی‌ها» is unique — the named list's is «حذف …».
    const deleteBtn = within(lists).getByRole('button', {
      name: /حذف علاقه‌مندی‌ها/,
    });
    expect(deleteBtn).toBeDisabled();
  });

  it('removes a saved business via DELETE /favorites/items/:id and toasts', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/favorites/me')) return { status: 200, body: okEnvelope(listsIndex) };
      if (url.includes(`/favorites/lists/${L_DEFAULT}/items`)) {
        // Both items render so the second card's remove button is reachable;
        // the remove mutation's invalidation refetches this same page.
        return { status: 200, body: okEnvelope(defaultListItems) };
      }
      if (url.includes(`/favorites/items/${ITEM_2}`) && method === 'DELETE') {
        return { status: 200, body: okEnvelope({ deleted: true }) };
      }
      return undefined;
    };
    renderView(handler);

    // Wait for the second saved card to render.
    const card = await screen.findByText('رستوران آریا');
    // The remove IconButton inside that card.
    const cardEl = card.closest('[data-testid="saved-business-card"]') as HTMLElement;
    const removeBtn = within(cardEl).getByRole('button', { name: /حذف از علاقه‌مندی‌ها/ });
    fireEvent.click(removeBtn);

    await screen.findByText(/رستوران آریا.*از علاقه‌مندی‌ها برداشته شد/);
  });
});
