// @vitest-environment jsdom
/**
 * CitiesAdmin component tests (F2.2). The admin cities page composes
 * AdminTable + modal form + confirm dialog against the B2.1 admin API.
 * Covered: list rendering with counts, the create flow posting a
 * schema-shaped body, and the delete flow with confirmation.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { CitiesAdmin } from '../../src/app/[locale]/(admin)/admin/cities/cities-admin';
import { okEnvelope, stubFetch, errorEnvelope } from '../auth/helpers';
import type { AdminCity } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/cities', useRouter: () => ({}) };
});

const TEHRAN: AdminCity = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'tehran',
  name: { fa: 'تهران', en: 'Tehran' },
  center: { lat: 35.6892, lng: 51.389 },
  bbox: { west: 51.05, south: 35.55, east: 51.65, north: 35.83 },
  timezone: 'Asia/Tehran',
  isActive: true,
  sortOrder: 1,
  neighborhoodCount: 8,
  businessCount: 6,
};

const SHIRAZ: AdminCity = {
  ...TEHRAN,
  id: '00000000-0000-4000-8000-000000000002',
  slug: 'shiraz',
  name: { fa: 'شیراز' },
  center: { lat: 29.5918, lng: 52.5837 },
  bbox: null,
  neighborhoodCount: 0,
  businessCount: 0,
};

function renderCities() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <CitiesAdmin />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('CitiesAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders city rows with slug and counts', async () => {
    stubFetch((url) =>
      url.includes('/admin/cities')
        ? { status: 200, body: okEnvelope({ items: [TEHRAN, SHIRAZ] }) }
        : undefined,
    );
    renderCities();
    expect(await screen.findByText('تهران')).toBeInTheDocument();
    expect(screen.getByText('شیراز')).toBeInTheDocument();
    // 8 neighborhoods · 6 businesses on the first row
    expect(screen.getAllByText(/۸ محله/).length).toBeGreaterThan(0);
  });

  it('creates a city through the modal with a contract-shaped body', async () => {
    const calls: Array<{ url: string; body: unknown; method: string }> = [];
    stubFetch((url, init) => {
      if (url.includes('/admin/cities') && (init?.method ?? 'GET') === 'POST') {
        calls.push({ url, body: JSON.parse(String(init?.body)), method: 'POST' });
        return {
          status: 201,
          body: okEnvelope({ ...TEHRAN, id: '00000000-0000-4000-8000-000000000009' }),
        };
      }
      if (url.includes('/admin/cities')) {
        return { status: 200, body: okEnvelope({ items: [TEHRAN] }) };
      }
      return undefined;
    });
    renderCities();
    fireEvent.click(await screen.findByRole('button', { name: 'افزودن شهر' }));
    fireEvent.change(screen.getByLabelText(/نام \(فارسی\)/), { target: { value: 'تبریز' } });
    fireEvent.change(screen.getByLabelText(/عرض جغرافیایی/), { target: { value: '38.08' } });
    fireEvent.change(screen.getByLabelText(/طول جغرافیایی/), { target: { value: '46.29' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const first = calls[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const body = first.body as Record<string, unknown>;
    expect(body.name).toEqual({ fa: 'تبریز' });
    expect(body.center).toEqual({ lat: 38.08, lng: 46.29 });
    expect(body.timezone).toBe('Asia/Tehran');
    expect(body.isActive).toBe(true);
  });

  it('client-side validation blocks an empty name and shows the required message', async () => {
    stubFetch((url) =>
      url.includes('/admin/cities') ? { status: 200, body: okEnvelope({ items: [] }) } : undefined,
    );
    renderCities();
    fireEvent.click(await screen.findByRole('button', { name: 'افزودن شهر' }));
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    // The zod form schema surfaces `validation.required` through the seeds.
    expect(await screen.findByText('این فیلد الزامی است.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ذخیره' })).toBeInTheDocument();
  });

  it('deletes a city after confirmation', async () => {
    const deletes: string[] = [];
    stubFetch((url, init) => {
      if (
        url.includes('/admin/cities/00000000-0000-4000-8000-000000000002') &&
        init?.method === 'DELETE'
      ) {
        deletes.push(url);
        return { status: 200, body: okEnvelope({ ok: true }) };
      }
      if (url.includes('/admin/cities')) {
        return { status: 200, body: okEnvelope({ items: [TEHRAN, SHIRAZ] }) };
      }
      return undefined;
    });
    renderCities();
    const row = (await screen.findByText('شیراز')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    // ConfirmDialog opens — confirm is scoped to the dialog role.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'حذف' }));
    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toContain(SHIRAZ.id);
  });

  it('surfaces a blocked delete (city still has businesses) without deleting', async () => {
    stubFetch((url, init) => {
      if (url.includes(TEHRAN.id) && init?.method === 'DELETE') {
        return { status: 422, body: errorEnvelope('BUSINESS_REFERENCED') };
      }
      if (url.includes('/admin/cities')) {
        return { status: 200, body: okEnvelope({ items: [TEHRAN] }) };
      }
      return undefined;
    });
    renderCities();
    const row = (await screen.findByText('تهران')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'حذف' }));
    expect(
      await screen.findByText('این شهر هنوز کسب‌وکار دارد؛ ابتدا آن را غیرفعال کنید.'),
    ).toBeInTheDocument();
  });
});
