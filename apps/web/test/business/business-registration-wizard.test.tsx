// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

/**
 * F4.10 BusinessRegistrationWizard — auth gate + 3-step flow → POST /businesses.
 * useAuth, apiFetch (dispatched by path), the i18n Link/useRouter and the
 * LocationPicker are mocked; the picker's onSelect is fired by a button.
 */
const useAuthMock = vi.fn();
const apiFetchMock = vi.fn();
const pushMock = vi.fn();

vi.mock('../../src/lib/auth/auth-context', () => ({ useAuth: useAuthMock }));
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));
vi.mock('../../src/i18n/navigation', () => ({
  Link: (props: { href: string; children?: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('../../src/components/map/location-picker', () => ({
  LocationPicker: (props: { onSelect?: (p: { lat: number; lng: number }) => void }) => (
    <button
      type="button"
      data-testid="mock-picker"
      onClick={() => props.onSelect?.({ lat: 35.7, lng: 51.4 })}
    >
      pick
    </button>
  ),
}));

const { BusinessRegistrationWizard } = await import(
  '../../src/components/business/business-registration-wizard'
);

const messages = {
  register: {
    title: 'ثبت',
    step: 'گام {n} از {total}',
    next: 'بعدی',
    back: 'قبلی',
    submit: 'ثبت',
    submitting: '…',
    success: 'ثبت شد.',
    loginRequired: 'وارد شوید.',
    login: 'ورود',
    error: 'خطا.',
    steps: { identity: 'هویت', location: 'موقعیت', contact: 'تماس' },
    fields: {
      name: 'نام',
      namePlaceholder: '…',
      nameAlt: 'جایگزین',
      description: 'درباره',
      descriptionPlaceholder: '…',
      primaryCategory: 'دسته',
      selectCategory: 'انتخاب…',
      secondaryCategories: 'فرعی',
      tags: 'برچسب',
      priceLevel: 'قیمت',
      priceNone: '—',
      price1: '۱',
      price2: '۲',
      price3: '۳',
      price4: '۴',
      city: 'شهر',
      selectCity: 'انتخاب…',
      neighborhood: 'محله',
      selectNeighborhood: '…',
      address: 'نشانی',
      addressPlaceholder: '…',
      location: 'نقشه',
      locationHint: '…',
      phone: 'تلفن',
      whatsapp: 'واتساپ',
      telegram: 'تلگرام',
      instagram: 'اینستاگرام',
      website: 'وب',
      email: 'ایمیل',
      amenities: 'امکانات',
    },
    review: 'بازبینی',
    reviewHint: '…',
  },
};

const city = {
  id: 'c1',
  slug: 'tehran',
  name: { fa: 'تهران' },
  center: { lat: 35.7, lng: 51.4 },
  bbox: { west: 51, south: 35, east: 52, north: 36 },
  timezone: 'Asia/Tehran',
  isDefault: true,
};
const cat = {
  id: 'cat1',
  slug: 'cafe',
  name: { fa: 'کافه' },
  description: null,
  icon: 'coffee',
  color: null,
  kind: 'menu',
  supportsReservation: false,
  children: [],
};
const amenity = {
  id: 'a1',
  slug: 'wifi',
  name: { fa: 'وای‌فای' },
  icon: 'wifi',
  group: 'general',
  isActive: true,
  sortOrder: 0,
};

function setupApiFetch() {
  apiFetchMock.mockImplementation(
    async (path: string, _schema: unknown, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'POST' && path === '/businesses') return { data: { slug: 'new-cafe' } };
      if (path === '/cities') return { data: { items: [city] } };
      if (path === '/categories') return { data: { items: [cat] } };
      if (path === '/amenities') return { data: { items: [amenity] } };
      if (String(path).includes('/neighborhoods')) return { data: { items: [] } };
      return { data: { items: [] } };
    },
  );
}

function renderWizard() {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessRegistrationWizard />
    </NextIntlClientProvider>,
  );
}

describe('BusinessRegistrationWizard', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    apiFetchMock.mockReset();
    pushMock.mockReset();
  });

  it('renders the login gate for anonymous visitors', () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'anonymous' });
    renderWizard();
    expect(screen.getByTestId('register-gate')).toHaveTextContent('وارد شوید.');
  });

  it('walks the 3 steps and submits the business', async () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u1' } });
    renderWizard();

    // step 0 — identity: fill name + pick a category, then Next
    await waitFor(() => expect(screen.getByTestId('register-step-identity')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('register-name'), { target: { value: 'کافه نمونه' } });
    fireEvent.change(screen.getByTestId('register-primary-category'), {
      target: { value: 'cat1' },
    });
    fireEvent.click(screen.getByTestId('register-next'));

    // step 1 — location: pick city + address + location
    await waitFor(() => expect(screen.getByTestId('register-step-location')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('register-city'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByTestId('register-address'), {
      target: { value: 'تهران، خیابان اصلی' },
    });
    fireEvent.click(screen.getByTestId('mock-picker'));
    fireEvent.click(screen.getByTestId('register-next'));

    // step 2 — contact: submit
    await waitFor(() => expect(screen.getByTestId('register-step-contact')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('register-submit'));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const postCall = apiFetchMock.mock.calls.find(
      (c) => (c[2] as { method?: string })?.method === 'POST',
    )!;
    expect(postCall[0]).toBe('/businesses');
    const body = (postCall[2] as { body: unknown }).body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'کافه نمونه',
      primaryCategoryId: 'cat1',
      cityId: 'c1',
      address: 'تهران، خیابان اصلی',
      location: { lat: 35.7, lng: 51.4 },
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/business/new-cafe'));
  });

  it('blocks step 0 → 1 until name + primary category are set', async () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u1' } });
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('register-step-identity')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('register-next'));
    expect(screen.getByTestId('register-step-error')).toBeInTheDocument();
    // still on step 0
    expect(screen.getByTestId('register-step-identity')).toBeInTheDocument();
  });
});
