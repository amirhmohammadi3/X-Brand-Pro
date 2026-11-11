import { getTranslations } from 'next-intl/server';
import { createFormatters } from '@/lib/format';
import { Badge } from '@/components/ui';
import type { MenuResponse } from '@app/contracts';

/**
 * Business menu / services section (F4.3). Renders the B4.9 aggregate's
 * `menu.sections` (each sorted by `sortOrder`, items sorted within), with
 * each item's name, description, price and availability. Prices are Rials →
 * `formatMoneyIrr` (Toman, Persian digits for fa); a null price is
 * «استعلام قیمت» (call for price); an unavailable item gets a muted badge.
 * Item photo thumbnails render when attached (same-origin /media proxies).
 *
 * Server component: `getTranslations('businessPage.menu')` is awaited here.
 * The section heading is rendered by the page; this component owns the list.
 */
export interface BusinessMenuProps {
  menu: MenuResponse;
  locale: string;
}

export async function BusinessMenu({ menu, locale }: BusinessMenuProps) {
  const t = await getTranslations('businessPage.menu');
  const { formatMoneyIrr } = createFormatters(locale);

  if (menu.sections.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="business-menu-empty">
        {t('empty')}
      </p>
    );
  }

  const sections = [...menu.sections].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-6" data-testid="business-menu">
      {sections.map((section) => {
        const items = [...section.items].sort((a, b) => a.sortOrder - b.sortOrder);
        return (
          <div key={section.id} className="flex flex-col gap-2" data-testid="business-menu-section">
            <h3 className="text-base font-semibold text-text">{section.name}</h3>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 py-2"
                  data-testid="business-menu-item"
                  data-available={item.isAvailable ? 'true' : 'false'}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                      {item.name}
                      {!item.isAvailable ? (
                        <Badge variant="neutral">{t('unavailable')}</Badge>
                      ) : null}
                    </span>
                    <span
                      className="text-sm tabular-nums text-muted"
                      data-testid="business-menu-price"
                    >
                      {item.price === null ? t('callForPrice') : formatMoneyIrr(item.price)}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="text-xs text-muted">{item.description}</p>
                  ) : null}
                  {item.photoThumbUrl ? (
                    <img
                      src={item.photoThumbUrl}
                      alt=""
                      loading="lazy"
                      className="mt-1 h-16 w-16 rounded object-cover"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
