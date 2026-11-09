// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';

/**
 * F3.4 map-search page client — mocked fetch (B3.2 /search + B3.4
 * /map/businesses), mocked maplibre (the shared FakeMap) and a recording
 * router. Asserts the list↔map contract: filters drive the LIST fetch, the
 * map viewport drives the MAP fetch, the results render as BusinessCards,
 * pagination pages, and the URL replaces canonically.
 */

const pushes: Array<unknown> = [];
const replaces: Array<unknown> = [];

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: (t: unknown) => pushes.push(t),
    replace: (t: unknown) => replaces.push(t),
    back: vi.fn(),
  }),
  // BusinessCard renders a <Link> — plain anchor passthrough (same href).
  Link: (props: { href: string; children?: React.ReactNode; className?: string }) => (
    <a href={typeof props.href === 'string' ? props.href : '#'} className={props.className}>
      {props.children}
    </a>
  ),
}));

class FakeMap {
  static instances: FakeMap[] = [];
  options: Record<string, unknown>;
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  removed = false;
  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeMap.instances.push(this);
  }
  on(event: string, ...rest: unknown[]): void {
    const handler = rest[rest.length - 1] as (...args: unknown[]) => void;
    const key = rest.length === 2 ? `${event}:${rest[0] as string}` : event;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
  }
  off(): void {}
  emit(key: string, arg: unknown = {}): void {
    for (const h of this.handlers.get(key) ?? []) h(arg);
  }
  addSource(): void {}
  getSource(): { setData: (d: unknown) => void } | undefined {
    return undefined;
  }
  addLayer(): void {}
  getLayer(): undefined {
    return undefined;
  }
  setLayoutProperty(): void {}
  addControl(): void {}
  getBounds(): {
    getWest: () => number;
    getSouth: () => number;
    getEast: () => number;
    getNorth: () => number;
  } {
    return { getWest: () => 51.0, getSouth: () => 35.5, getEast: () => 51.8, getNorth: () => 36.0 };
  }
  getZoom(): number {
    return 10;
  }
  getCenter(): { lat: number; lng: number } {
    return { lat: 35.6892, lng: 51.389 };
  }
  flyTo(): void {}
  easeTo(): void {}
  setStyle(): void {}
  remove(): void {
    this.removed = true;
  }
}

vi.mock('maplibre-gl', () => {
  class Popup {
    setLngLat(): this {
      return this;
    }
    setHTML(): this {
      return this;
    }
    addTo(): this {
      return this;
    }
  }
  return {
    Map: FakeMap,
    Popup,
    NavigationControl: class NavigationControl {},
    GeolocateControl: class GeolocateControl {
      on(): void {}
    },
    addProtocol: vi.fn(),
    AttributionControl: class AttributionControl {},
  };
});

vi.mock('pmtiles', () => ({
  Protocol: class Protocol {
    tile = () => undefined;
  },
}));

// The Rating component pulls `ui.*` translations; provide them.
const messages = {
  ui: { rating: { label: 'امتیاز {value} از {max}', star: '{value} ستاره' } },
  form: { overlay: 'بستن' },
  search: {
    label: 'جست‌وجوی کسب‌وکارها',
    placeholder: 'کافه، رستوران…',
    loading: 'در حال جست‌وجو…',
    noResults: 'نتیجه‌ای یافت نشد',
    pageTitle: 'جست‌وجوی نقشه‌محور',
    pageDescription: 'جست‌وجوی کسب‌وکارها روی نقشه',
    resultsTitle: 'نتایج جست‌وجو',
    resultsCount: '{count} کسب‌وکار',
    filters: {
      city: 'شهر',
      allCities: 'همهٔ شهرها',
      minRating: 'حداقل امتیاز',
      anyRating: 'هر امتیازی',
      minRatingValue: '{value} و بالاتر',
      sort: 'مرتب‌سازی',
    },
    sort: { relevance: 'مرتبط‌ترین', rating: 'بیشترین امتیاز', newest: 'جدیدترین' },
    pagination: { prev: 'قبلی', next: 'بعدی' },
    groups: { business: 'کسب‌وکارها', category: 'دسته‌ها', neighborhood: 'محله‌ها', city: 'شهرها' },
    recent: { title: 'جست‌وجوهای اخیر', clear: 'پاک کردن همه', removeOne: 'حذف {query}' },
    popular: { title: 'پرطرفدار' },
  },
  map: { aria: 'نقشه', popup: { rating: 'امتیاز' } },
};

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function okEnvelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ ok: true, data }),
  } as unknown as Response;
}

const searchResponse = {
  items: [
    {
      id: '33333333-3333-3333-3333-333333333331',
      slug: 'cafe-azadi',
      name: 'کافه آزادی',
      nameAlt: null,
      primaryCategoryId: '44444444-4444-4444-4444-444444444441',
      primaryCategorySlug: 'cafe',
      primaryCategoryName: { fa: 'کافه', en: 'Cafe' },
      cityId: '55555555-5555-5555-5555-555555555551',
      citySlug: 'tehran',
      cityName: { fa: 'تهران', en: 'Tehran' },
      neighborhoodId: null,
      address: 'ولیعصر، پلاک ۱',
      location: { lat: 35.7, lng: 51.4 },
      priceLevel: 2,
      avgRating: 4.5,
      reviewCount: 12,
      coverUrl: null,
      thumbUrl: null,
      isFeatured: false,
      distance: null,
      rank: 0,
    },
  ],
  meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
};

const mapResponse = {
  mode: 'clusters' as const,
  items: [{ location: { lat: 35.7, lng: 51.4 }, count: 21 }],
  meta: { zoom: 10, total: 21, truncated: false },
};

const citiesResponse = {
  items: [
    {
      id: '55555555-5555-5555-5555-555555555551',
      slug: 'tehran',
      name: { fa: 'تهران', en: 'Tehran' },
      center: { lat: 35.6892, lng: 51.389 },
      bbox: null,
      timezone: 'Asia/Tehran',
      isDefault: true,
    },
  ],
};

const { SearchPageClient } = await import('../../src/components/search/search-page-client');

function renderPage(initialFilters = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="fa" messages={messages}>
        <SearchPageClient initialFilters={initialFilters} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pushes.length = 0;
  replaces.length = 0;
  FakeMap.instances = [];
  vi.stubGlobal('fetch', fetchMock as unknown);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/map/businesses')) return Promise.resolve(okEnvelope(mapResponse));
    if (u.includes('/cities')) return Promise.resolve(okEnvelope(citiesResponse));
    if (u.includes('/search/history')) return Promise.resolve(okEnvelope({ items: [] }));
    return Promise.resolve(okEnvelope(searchResponse));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearchPageClient (F3.4)', () => {
  it('fetches the list + map and renders the results as business cards', async () => {
    renderPage({ q: 'کافه' });
    // the list renders in BOTH the desktop side panel and the mobile sheet
    // (both mounted in jsdom; CSS decides visibility on real devices)
    await waitFor(() =>
      expect(screen.getAllByTestId('business-card').length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getAllByText('کافه آزادی').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('search-results-count').length).toBeGreaterThanOrEqual(1);
    const searchUrl = String(
      fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/v1/search?'))?.[0],
    );
    expect(searchUrl).toContain('q=%DA%A9%D8%A7%D9%81%D9%87');
    // MapLibre fires 'load' itself; the fake needs the manual emit — applyData
    // then emits the viewport, which enables the /map/businesses query.
    const map = FakeMap.instances[0]!;
    act(() => {
      map.emit('load');
    });
    await waitFor(() => {
      const mapUrl = String(
        fetchMock.mock.calls.find((c) => String(c[0]).includes('/map/businesses'))?.[0],
      );
      expect(mapUrl).toContain('bbox=51%2C35.5%2C51.8%2C36');
      expect(mapUrl).toContain('zoom=10');
    });
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('the map viewport emission refetches /map/businesses with the new bbox', async () => {
    renderPage();
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0]!;
    act(() => {
      map.emit('load');
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/map/businesses'))).toBe(true),
    );
    const callsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/map/businesses'),
    ).length;
    // move the bounds (a real pan changes them) — the NEW query key triggers
    // the refetch; the emission URL carries the bbox the map reports.
    map.getBounds = () => ({
      getWest: () => 51.2,
      getSouth: () => 35.6,
      getEast: () => 51.9,
      getNorth: () => 36.1,
    });
    act(() => {
      map.emit('moveend');
    });
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes('/map/businesses'),
      ).length;
      expect(calls).toBe(callsBefore + 1);
    });
    const url = String(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/map/businesses')).at(-1)?.[0],
    );
    expect(url).toContain('bbox=51.2%2C35.6%2C51.9%2C36.1');
  });

  it('city filter change refetches the list with cityId and replaces the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId('business-card').length).toBeGreaterThanOrEqual(1),
    );
    const listCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/v1/search?'),
    ).length;
    const select = screen.getByTestId('filter-city');
    await user.selectOptions(select, '55555555-5555-5555-5555-555555555551');
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes('/api/v1/search?'),
      ).length;
      expect(listCalls).toBe(listCallsBefore + 1);
    });
    const url = String(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/v1/search?')).at(-1)?.[0],
    );
    expect(url).toContain('cityId=55555555-5555-5555-5555-555555555551');
    expect(replaces.length).toBeGreaterThan(0);
    expect(JSON.stringify(replaces.at(-1))).toContain('cityId=');
  });

  it('minRating filter passes through to the list fetch', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId('business-card').length).toBeGreaterThanOrEqual(1),
    );
    await user.selectOptions(screen.getByTestId('filter-rating'), '4');
    await waitFor(() => {
      const url = String(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/v1/search?')).at(-1)?.[0],
      );
      expect(url).toContain('minRating=4');
    });
  });

  it('pagination: next button fetches page=2', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId('business-card').length).toBeGreaterThanOrEqual(1),
    );
    // inside the modal sheet (Radix portals the sheet's copy to body end)
    const nextButtons = screen.getAllByTestId('search-page-next');
    await user.click(nextButtons[nextButtons.length - 1]!);
    await waitFor(() => {
      const url = String(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/v1/search?')).at(-1)?.[0],
      );
      expect(url).toContain('page=2');
    });
  });

  it('raw query submit (Enter) updates the filters in place', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId('business-card').length).toBeGreaterThanOrEqual(1),
    );
    const inputs = screen.getAllByTestId('search-input');
    await user.type(inputs[inputs.length - 1]!, 'چلوکباب');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const url = String(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/v1/search?')).at(-1)?.[0],
      );
      expect(url).toContain('q=');
      expect(url).toContain(encodeURIComponent('چلوکباب'));
    });
  });

  it('renders the empty state when the API answers with no hits', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/map/businesses')) return Promise.resolve(okEnvelope(mapResponse));
      if (u.includes('/cities')) return Promise.resolve(okEnvelope(citiesResponse));
      return Promise.resolve(
        okEnvelope({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      );
    });
    renderPage({ q: 'هیچی' });
    await waitFor(() =>
      expect(screen.getAllByTestId('search-results-empty').length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.queryAllByTestId('business-card')).toHaveLength(0);
  });
});
