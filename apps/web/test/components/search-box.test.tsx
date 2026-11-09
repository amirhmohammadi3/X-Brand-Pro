// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';

/**
 * F3.6 search surfaces — the SearchBox combobox (debounce + keyboard + ARIA +
 * navigation targets), the recent-searches chips (delete/clear flows) and the
 * popular-queries chips, over mocked fetch responses shaped exactly like the
 * B3.3/B3.5 contracts.
 */

// next-intl navigation is mocked: push() records the TARGET as given (the
// object form) — asserting the /search scope params is what F3.6 cares about.
const pushes: Array<unknown> = [];
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: (target: unknown) => {
      pushes.push(target);
    },
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function okEnvelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ ok: true, data }),
  } as unknown as Response;
}

function makeClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return qc;
}

function renderWith(ui: React.ReactNode) {
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="fa" messages={messages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const messages = {
  search: {
    label: 'جست‌وجوی کسب‌وکارها',
    placeholder: 'کافه، رستوران…',
    loading: 'در حال جست‌وجو…',
    noResults: 'نتیجه‌ای یافت نشد',
    groups: {
      business: 'کسب‌وکارها',
      category: 'دسته‌ها',
      neighborhood: 'محله‌ها',
      city: 'شهرها',
    },
    recent: {
      title: 'جست‌وجوهای اخیر',
      clear: 'پاک کردن همه',
      removeOne: 'حذف جست‌وجوی {query}',
    },
    popular: { title: 'جست‌وجوهای پرطرفدار' },
  },
};

const suggestResponse = {
  items: [
    {
      kind: 'business' as const,
      id: '33333333-3333-3333-3333-333333333331',
      slug: 'cafe-azadi',
      label: 'کافه آزادی',
      labelAlt: null,
      sublabel: 'تهران',
      score: 0.9,
    },
    {
      kind: 'category' as const,
      id: '44444444-4444-4444-4444-444444444441',
      slug: 'cafe',
      label: 'کافه',
      labelAlt: 'Cafe',
      sublabel: null,
      score: 0.7,
    },
    {
      kind: 'city' as const,
      id: '55555555-5555-5555-5555-555555555551',
      slug: 'karaj',
      label: 'کرج',
      labelAlt: 'Karaj',
      sublabel: null,
      score: 0.5,
    },
  ],
};

const { SearchBox } = await import('../../src/components/search/search-box');
const { RecentSearches } = await import('../../src/components/search/recent-searches');
const { PopularQueries } = await import('../../src/components/search/popular-queries');
const { buildLocaleHref, buildSuggestHitTarget } = await import('../../src/lib/search/links');

beforeEach(() => {
  pushes.length = 0;
  vi.stubGlobal('fetch', fetchMock as unknown);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildLocaleHref / buildSuggestHitTarget (F3.6)', () => {
  it('fa stays unprefixed, en gets the prefix (as-needed routing)', () => {
    expect(buildLocaleHref('fa', '/business/x')).toBe('/business/x');
    expect(buildLocaleHref('en', '/business/x')).toBe('/en/business/x');
  });

  it('hits target the /search page with their scope param', () => {
    expect(buildSuggestHitTarget(suggestResponse.items[0]!)).toEqual({
      kind: 'search',
      path: '/search',
      query: { q: 'کافه آزادی' },
    });
    expect(buildSuggestHitTarget(suggestResponse.items[1]!)).toEqual({
      kind: 'search',
      path: '/search',
      query: { categoryIds: '44444444-4444-4444-4444-444444444441' },
    });
    expect(buildSuggestHitTarget(suggestResponse.items[2]!)).toEqual({
      kind: 'search',
      path: '/search',
      query: { cityId: '55555555-5555-5555-5555-555555555551' },
    });
  });
});

describe('SearchBox (F3.6)', () => {
  it('does not fetch below 2 chars or before the debounce elapses', async () => {
    const user = userEvent.setup();
    renderWith(<SearchBox />);
    await user.type(screen.getByTestId('search-input'), 'ک');
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('search-listbox')).not.toBeInTheDocument();
  });

  it('fetches suggest after the debounce and renders grouped hits', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okEnvelope(suggestResponse));
    renderWith(<SearchBox />);
    await user.type(screen.getByTestId('search-input'), 'کاف');
    await waitFor(() => expect(screen.getByTestId('search-listbox')).toBeInTheDocument(), {
      timeout: 3000,
    });
    await waitFor(() => {
      expect(screen.getByTestId('search-group-business')).toHaveTextContent('کسب‌وکارها');
      expect(screen.getByTestId('search-group-category')).toHaveTextContent('دسته‌ها');
      expect(screen.getAllByTestId('search-option-business')).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/search/suggest');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('q=');
  });

  it('keyboard: ArrowDown activates, Enter navigates to the hit target', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okEnvelope(suggestResponse));
    renderWith(<SearchBox />);
    const input = screen.getByTestId('search-input');
    await user.type(input, 'کاف');
    await waitFor(() => expect(screen.getAllByTestId('search-option-business')).toHaveLength(1));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toMatchObject({ pathname: '/search', query: { q: 'کافه آزادی' } });
  });

  it('Enter with a raw query (no selection) pushes /search?q=…', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okEnvelope({ items: [] }));
    renderWith(<SearchBox />);
    const input = screen.getByTestId('search-input');
    await user.type(input, 'چلوکباب');
    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toMatchObject({ pathname: '/search', query: { q: 'چلوکباب' } });
  });

  it('Escape closes the listbox (aria-expanded=false)', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okEnvelope(suggestResponse));
    renderWith(<SearchBox />);
    const input = screen.getByTestId('search-input');
    await user.type(input, 'کاف');
    await waitFor(() => expect(screen.getByTestId('search-listbox')).toBeInTheDocument());
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('search-listbox')).not.toBeInTheDocument();
  });

  it('no results under 2 chars never renders the listbox', () => {
    renderWith(<SearchBox />);
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'ک' } });
    expect(screen.queryByTestId('search-listbox')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('RecentSearches (F3.6)', () => {
  const history = {
    items: [
      {
        id: '66666666-6666-6666-6666-666666666661',
        text: 'کافه',
        cityId: null,
        cityName: null,
        searchedAt: '2026-11-09T10:00:00.000Z',
      },
      {
        id: '66666666-6666-6666-6666-666666666662',
        text: 'رستوران',
        cityId: null,
        cityName: null,
        searchedAt: '2026-11-09T09:00:00.000Z',
      },
    ],
  };

  it('renders chips, removes one via DELETE, clears all via DELETE', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if ((init as RequestInit | undefined)?.method === 'DELETE') {
        return Promise.resolve(okEnvelope({ deleted: 1 }));
      }
      return Promise.resolve(okEnvelope(history));
    });
    renderWith(<RecentSearches />);
    await waitFor(() => expect(screen.getAllByTestId('recent-chip')).toHaveLength(2));
    // re-run a search by clicking the chip
    await user.click(screen.getAllByTestId('recent-chip-link')[0]!);
    await waitFor(() =>
      expect(pushes[0]).toMatchObject({ pathname: '/search', query: { q: 'کافه' } }),
    );
    // remove one
    await user.click(screen.getAllByTestId('recent-chip-remove')[0]!);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(String(del?.[0])).toContain('/search/history/66666666-6666-6666-6666-666666666661');
    });
    // clear all
    await user.click(screen.getByTestId('recent-clear'));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(String(calls.at(-1)?.[0])).toContain('/api/v1/search/history');
      expect(String(calls.at(-1)?.[0])).not.toContain('/api/v1/search/history/');
    });
  });

  it('renders NOTHING for anonymous visitors (401 → empty, no error banner)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'nope' } }),
    } as unknown as Response);
    renderWith(<RecentSearches />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('recent-searches')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('PopularQueries (F3.6)', () => {
  it('renders chips and keeps city scope on re-run', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      okEnvelope({
        items: [
          {
            text: 'کافه',
            cityId: '77777777-7777-7777-7777-777777777771',
            cityName: { fa: 'تهران' },
            hits: 128,
            lastSearchedAt: '2026-11-09T12:00:00.000Z',
          },
          {
            text: 'رستوران',
            cityId: null,
            cityName: null,
            hits: 90,
            lastSearchedAt: '2026-11-09T11:00:00.000Z',
          },
        ],
      }),
    );
    renderWith(<PopularQueries />);
    await waitFor(() => expect(screen.getAllByTestId('popular-chip')).toHaveLength(2));
    await user.click(screen.getAllByTestId('popular-chip')[0]!);
    await waitFor(() =>
      expect(pushes[0]).toMatchObject({
        pathname: '/search',
        query: { q: 'کافه', cityId: '77777777-7777-7777-7777-777777777771' },
      }),
    );
    await user.click(screen.getAllByTestId('popular-chip')[1]!);
    await waitFor(() =>
      expect(pushes[1]).toMatchObject({ pathname: '/search', query: { q: 'رستوران' } }),
    );
  });

  it('renders nothing while no popularity data exists', async () => {
    fetchMock.mockResolvedValue(okEnvelope({ items: [] }));
    renderWith(<PopularQueries />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('popular-queries')).not.toBeInTheDocument();
  });
});
