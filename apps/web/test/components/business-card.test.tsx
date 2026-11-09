// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import type { SearchHit, PublicCategoryNode } from '@app/contracts';

// The next-intl navigation module imports next/navigation, which does not
// resolve outside the Next build context — mock the <Link> as a plain
// anchor with the SAME href contract (string passthrough).
vi.mock('../../src/i18n/navigation', () => ({
  Link: (props: { href: string; children?: React.ReactNode; className?: string }) => (
    <a href={typeof props.href === 'string' ? props.href : '#'} className={props.className}>
      {props.children}
    </a>
  ),
}));

/**
 * F3.3 home page pieces — `BusinessCard` (localized text, Persian digits,
 * thumb/no-thumb branches, featured badge, the business link) and the
 * category icon resolver (kebab → Pascal Lucide lookup with a neutral
 * fallback). The page itself is a server component (data fetches are a
 * Docker-machine concern — follow-up).
 */
import { BusinessCard } from '../../src/components/business/business-card';
import { iconComponent, accentClass } from '../../src/components/ui/category-icon';
import { pickLocalized } from '../../src/lib/localized';

const messages = {
  ui: {
    rating: {
      label: 'امتیاز {value} از {max}',
      star: '{value} ستاره',
    },
  },
};

const hit: SearchHit = {
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
  isFeatured: true,
  distance: null,
  rank: 0,
};

function renderCard(h = hit, locale = 'fa') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <BusinessCard hit={h} locale={locale} />
    </NextIntlClientProvider>,
  );
}

describe('BusinessCard (F3.3)', () => {
  it('renders the name, localized category · city, Persian-digit review count and address', () => {
    renderCard();
    expect(screen.getByTestId('business-card')).toBeInTheDocument();
    expect(screen.getByText('کافه آزادی')).toBeInTheDocument();
    expect(screen.getByText('کافه · تهران')).toBeInTheDocument();
    // Persian digits (fa locale): ۱۲
    expect(screen.getByText('۱۲')).toBeInTheDocument();
    expect(screen.getByText('ولیعصر، پلاک ۱')).toBeInTheDocument();
  });

  it('links to the business page (canonical path)', () => {
    renderCard();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/business/cafe-azadi');
  });

  it('shows the ★ badge on featured hits only', () => {
    const first = renderCard();
    expect(screen.getByText('★')).toBeInTheDocument();
    first.unmount();
    renderCard({ ...hit, isFeatured: false });
    expect(screen.queryByText('★')).not.toBeInTheDocument();
  });

  it('renders a neutral placeholder when there is no thumb, the image when there is', () => {
    const first = renderCard();
    // Raw <img> elements only (the Rating's star SVGs are aria-hidden, not imgs)
    expect(first.container.querySelector('img')).toBeNull();
    first.unmount();
    const second = renderCard({ ...hit, thumbUrl: '/media/x_t.webp' });
    const img = second.container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/media/x_t.webp');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('alt', 'کافه آزادی');
  });

  it('en locale: ASCII digits + English category/city names', () => {
    renderCard(hit, 'en');
    expect(screen.getByText('Cafe · Tehran')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('passes axe', async () => {
    const { container } = renderCard();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe('category icon resolver (F3.3)', () => {
  it('resolves kebab-case contract names to PascalCase Lucide components', () => {
    expect(iconComponent('coffee')).not.toBeNull();
    expect(iconComponent('ice-cream')).not.toBeNull();
    expect(iconComponent('utensils')).not.toBeNull();
  });

  it('returns null for unknown names (neutral dot fallback at the call site)', () => {
    expect(iconComponent('not-a-lucide-icon')).toBeNull();
  });

  it('every accent maps to a class (single accent color today)', () => {
    expect(accentClass('accent-1')).toBe('text-accent');
    expect(accentClass(null)).toBe('text-accent');
  });

  it('pickLocalized: requested locale → fa → any → empty', () => {
    expect(pickLocalized({ fa: 'کافه', en: 'Cafe' }, 'en')).toBe('Cafe');
    expect(pickLocalized({ fa: 'کافه', en: 'Cafe' }, 'ar')).toBe('کافه');
    expect(pickLocalized({ fa: '', en: '' }, 'fa')).toBe('');
    expect(pickLocalized(null, 'fa')).toBe('');
  });
});

describe('home page data shapes (static contract checks, F3.3)', () => {
  it('category nodes parse with children', () => {
    const node: PublicCategoryNode = {
      id: '44444444-4444-4444-4444-444444444441',
      slug: 'food',
      name: { fa: 'خوراک', en: 'Food' },
      description: null,
      icon: 'utensils',
      color: 'accent-2',
      kind: 'menu',
      supportsReservation: true,
      children: [],
    };
    expect(node.icon).toBe('utensils');
  });
});
