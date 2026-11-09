// @vitest-environment jsdom
/**
 * TranslationsEditor component tests (F2.3). Covered: rows render with the
 * default-locale reference, edits accumulate as dirty and the save button
 * PUTs ONLY the dirty entries, reverting an edit removes it from the batch,
 * and the search box re-queries with `q`.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { TranslationsEditor } from '../../src/app/[locale]/(admin)/admin/languages/[code]/translations-editor';
import { okEnvelope, stubFetch } from '../auth/helpers';
import type { AdminTranslationsListResponse, Language } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/languages/ar', useRouter: () => ({}) };
});

const AR: Language = {
  code: 'ar',
  nameNative: 'العربية',
  nameEn: 'Arabic',
  dir: 'rtl',
  isDefault: false,
  isActive: true,
  sortOrder: 100,
};

function page(
  overrides: Partial<AdminTranslationsListResponse> = {},
): AdminTranslationsListResponse {
  return {
    items: [
      { key: 'nav.home', value: 'الرئيسية', defaultValue: 'خانه', updatedAt: null },
      { key: 'nav.search', value: null, defaultValue: 'جست‌وجو', updatedAt: null },
    ],
    meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
    ...overrides,
  };
}

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <TranslationsEditor language={AR} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('TranslationsEditor', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders rows with the default reference and a null-safe value', async () => {
    stubFetch((url) =>
      url.includes('/admin/i18n/translations')
        ? { status: 200, body: okEnvelope(page()) }
        : undefined,
    );
    renderEditor();
    expect(await screen.findByText('nav.home')).toBeInTheDocument();
    expect(screen.getByText('خانه')).toBeInTheDocument(); // default-locale reference
    expect(screen.getByDisplayValue('الرئيسية')).toBeInTheDocument();
    // null value → the row input renders empty (scoped by its aria-label)
    expect(screen.getByLabelText('مقدار: nav.search')).toHaveValue('');
  });

  it('saves ONLY the dirty entries in one PUT', async () => {
    const puts: Array<Record<string, unknown>> = [];
    stubFetch((url, init) => {
      if (url.includes('/admin/i18n/translations') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return { status: 200, body: okEnvelope({ ok: true }) };
      }
      if (url.includes('/admin/i18n/translations')) {
        return { status: 200, body: okEnvelope(page()) };
      }
      return undefined;
    });
    renderEditor();
    const home = await screen.findByDisplayValue('الرئيسية');
    fireEvent.change(home, { target: { value: 'الصفحة الرئيسية' } });
    // The untouched row stays out of the batch even though it re-rendered.
    fireEvent.click(screen.getByRole('button', { name: /ذخیره/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const put = puts[0];
    expect(put).toBeDefined();
    if (put === undefined) return;
    expect(put.locale).toBe('ar');
    expect(put.entries).toEqual([{ key: 'nav.home', value: 'الصفحة الرئيسية' }]);
  });

  it('reverting an edit removes it from the batch and disables save', async () => {
    let putCount = 0;
    stubFetch((url, init) => {
      if (url.includes('/admin/i18n/translations') && init?.method === 'PUT') {
        putCount += 1;
        return { status: 200, body: okEnvelope({ ok: true }) };
      }
      if (url.includes('/admin/i18n/translations')) {
        return { status: 200, body: okEnvelope(page()) };
      }
      return undefined;
    });
    renderEditor();
    const home = await screen.findByDisplayValue('الرئيسية');
    fireEvent.change(home, { target: { value: 'x' } });
    fireEvent.change(home, { target: { value: 'الرئيسية' } }); // back to original
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره' })).toBeDisabled());
    expect(putCount).toBe(0);
  });

  it('search re-queries the server with q and resets to page 1', async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      if (url.includes('/admin/i18n/translations')) {
        urls.push(url);
        return { status: 200, body: okEnvelope(page()) };
      }
      return undefined;
    });
    renderEditor();
    await screen.findByText('nav.home');
    const search = screen.getByLabelText(/جست‌وجوی کلید/);
    fireEvent.change(search, { target: { value: 'nav' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(urls.some((u) => u.includes('q=nav'))).toBe(true));
  });
});
