// @vitest-environment jsdom
/**
 * LanguagesAdmin component tests (F2.3). Covered: list rendering with the
 * default badge, the create flow posting a contract-shaped body, and the
 * delete flow (fa/default rows render no delete button — server enforces
 * the same rule).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { LanguagesAdmin } from '../../src/app/[locale]/(admin)/admin/languages/languages-admin';
import { okEnvelope, stubFetch } from '../auth/helpers';
import type { Language } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/languages', useRouter: () => ({}) };
});

const FA: Language = {
  code: 'fa',
  nameNative: 'فارسی',
  nameEn: 'Persian',
  dir: 'rtl',
  isDefault: true,
  isActive: true,
  sortOrder: 1,
};

const AR: Language = {
  code: 'ar',
  nameNative: 'العربية',
  nameEn: 'Arabic',
  dir: 'rtl',
  isDefault: false,
  isActive: false,
  sortOrder: 100,
};

function renderLanguages() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <LanguagesAdmin />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('LanguagesAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders languages with the default badge and hides delete for fa', async () => {
    stubFetch((url) =>
      url.includes('/admin/i18n/languages')
        ? { status: 200, body: okEnvelope({ items: [FA, AR] }) }
        : undefined,
    );
    renderLanguages();
    expect(await screen.findByText('فارسی')).toBeInTheDocument();
    expect(screen.getByText('پیش‌فرض')).toBeInTheDocument();
    const faRow = screen.getByText('fa').closest('tr') as HTMLElement;
    expect(within(faRow).queryByRole('button', { name: 'حذف' })).toBeNull();
    const arRow = screen.getByText('ar').closest('tr') as HTMLElement;
    expect(within(arRow).getByRole('button', { name: 'حذف' })).toBeInTheDocument();
  });

  it('creates a language with a contract-shaped body', async () => {
    const posts: Array<Record<string, unknown>> = [];
    stubFetch((url, init) => {
      if (url.includes('/admin/i18n/languages') && (init?.method ?? 'GET') === 'POST') {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: okEnvelope(AR) };
      }
      if (url.includes('/admin/i18n/languages')) {
        return { status: 200, body: okEnvelope({ items: [FA] }) };
      }
      return undefined;
    });
    renderLanguages();
    fireEvent.click(await screen.findByRole('button', { name: 'افزودن زبان' }));
    fireEvent.change(screen.getByLabelText(/کد زبان/), { target: { value: 'ar' } });
    fireEvent.change(screen.getByLabelText(/نام بومی/), { target: { value: 'العربية' } });
    fireEvent.change(screen.getByLabelText(/نام انگلیسی/), { target: { value: 'Arabic' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const first = posts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.code).toBe('ar');
    expect(first.dir).toBe('rtl');
    expect(first.sortOrder).toBe(100);
  });

  it('blocks an invalid code client-side', async () => {
    stubFetch((url) =>
      url.includes('/admin/i18n/languages')
        ? { status: 200, body: okEnvelope({ items: [FA] }) }
        : undefined,
    );
    renderLanguages();
    fireEvent.click(await screen.findByRole('button', { name: 'افزودن زبان' }));
    fireEvent.change(screen.getByLabelText(/کد زبان/), { target: { value: 'Farsi!' } });
    fireEvent.change(screen.getByLabelText(/نام بومی/), { target: { value: 'فارسی' } });
    fireEvent.change(screen.getByLabelText(/نام انگلیسی/), { target: { value: 'Persian' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    expect(
      await screen.findByText('کد زبان باید دو حرف لاتین (یا دو حرف + کشور مثل pt-BR) باشد.'),
    ).toBeInTheDocument();
  });

  it('deletes a non-default language after confirmation', async () => {
    const deletes: string[] = [];
    stubFetch((url, init) => {
      if (url.includes('/admin/i18n/languages/ar') && init?.method === 'DELETE') {
        deletes.push(url);
        return { status: 200, body: okEnvelope({ deleted: true }) };
      }
      if (url.includes('/admin/i18n/languages')) {
        return { status: 200, body: okEnvelope({ items: [FA, AR] }) };
      }
      return undefined;
    });
    renderLanguages();
    const row = (await screen.findByText('ar')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'حذف' }));
    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toContain('/ar');
  });
});
