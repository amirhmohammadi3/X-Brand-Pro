// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MenuResponse } from '@app/contracts';

/**
 * F4.3 BusinessMenu — the menu/services list. The component is an async
 * SERVER component (`getTranslations`), so `next-intl/server` is mocked to
 * resolve keys from a tiny messages object and the component is AWAITED
 * directly (it is just an async function returning JSX) before `render`.
 * `createFormatters` runs real (pure Intl + toPersianDigits — works in jsdom).
 *
 * Covers: empty menu → empty label; sections/items sorted by sortOrder; a
 * priced item renders the formatted Toman price (Rials → formatMoneyIrr); a
 * null-price item renders «استعلام قیمت»; an unavailable item gets the badge.
 */
import { createFormatters } from '../../src/lib/format';

const MOCK_MESSAGES: Record<string, Record<string, string>> = {
  'businessPage.menu': {
    empty: 'منویی ثبت نشده است.',
    unavailable: 'ناموجود',
    callForPrice: 'استعلام قیمت',
  },
};

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async (ns: string) => (key: string, values?: Record<string, string | number>) => {
      const leaf = MOCK_MESSAGES[ns]?.[key];
      let s = leaf ?? key;
      if (values)
        for (const [k, v] of Object.entries(values)) s = String(s).replace(`{${k}}`, String(v));
      return s;
    },
  ),
}));

const { BusinessMenu } = await import('../../src/components/business/business-menu');

const menu: MenuResponse = {
  sections: [
    {
      id: 's1',
      businessId: 'b1',
      name: 'نوشیدنی‌ها',
      sortOrder: 1,
      items: [
        {
          id: 'i1',
          sectionId: 's1',
          name: 'چای',
          description: 'چای سیاه سنتی',
          price: 50000,
          photoUrl: null,
          photoThumbUrl: null,
          isAvailable: true,
          sortOrder: 2,
        },
        {
          id: 'i2',
          sectionId: 's1',
          name: 'قهوه فرانسوی',
          description: null,
          price: null,
          photoUrl: null,
          photoThumbUrl: null,
          isAvailable: false,
          sortOrder: 1,
        },
      ],
    },
  ],
};

async function renderMenu(menu: MenuResponse, locale = 'fa') {
  const tree = await BusinessMenu({ menu, locale });
  return render(tree);
}

describe('BusinessMenu', () => {
  it('renders the empty label when there are no sections', async () => {
    await renderMenu({ sections: [] });
    expect(screen.getByTestId('business-menu-empty')).toHaveTextContent('منویی ثبت نشده است.');
    expect(screen.queryByTestId('business-menu')).toBeNull();
  });

  it('renders sections and items sorted by sortOrder', async () => {
    await renderMenu(menu);
    const items = screen.getAllByTestId('business-menu-item');
    expect(items).toHaveLength(2);
    // sortOrder 1 (قهوه) before sortOrder 2 (چای)
    expect(items[0]!).toHaveTextContent('قهوه فرانسوی');
    expect(items[1]!).toHaveTextContent('چای');
    expect(screen.getAllByTestId('business-menu-section')).toHaveLength(1);
  });

  it('formats a priced item as Toman and leaves a null price as «استعلام قیمت»', async () => {
    await renderMenu(menu);
    const prices = screen.getAllByTestId('business-menu-price');
    // i2 (قهوه, null price) is first (sortOrder 1) → call for price
    expect(prices[0]!).toHaveTextContent('استعلام قیمت');
    // i1 (چای, 50000 Rials = 5000 Toman) → formatMoneyIrr
    const { formatMoneyIrr } = createFormatters('fa');
    expect(prices[1]!).toHaveTextContent(formatMoneyIrr(50000));
  });

  it('badges unavailable items and marks them data-available="false"', async () => {
    await renderMenu(menu);
    const items = screen.getAllByTestId('business-menu-item');
    expect(items[0]!).toHaveAttribute('data-available', 'false'); // قهوه unavailable
    expect(items[0]!).toHaveTextContent('ناموجود');
    expect(items[1]!).toHaveAttribute('data-available', 'true'); // چای available
    expect(items[1]!).not.toHaveTextContent('ناموجود');
  });
});
