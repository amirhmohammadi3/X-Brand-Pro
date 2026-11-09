import { Link } from '@/i18n/navigation';
import { Rating } from '@/components/ui/rating';
import { pickLocalized } from '@/lib/localized';
import { createFormatters } from '@/lib/format';
import type { SearchHit } from '@app/contracts';

/**
 * `BusinessCard` (F3.3) — the list/grid card for search hits; shared by the
 * home page's featured grid (F3.3) and the map-search results list (F3.4).
 * Server-safe: the only client boundary is the display-only `Rating`.
 *
 * The whole card links to the business page (F4.1 owns that route; the card
 * already renders the canonical path). Text follows the localized fallback
 * (pickLocalized) and counts format through `createFormatters` (Persian
 * digits for fa) — F1.1 rules.
 */
export interface BusinessCardProps {
  hit: SearchHit;
  locale: string;
}

export function BusinessCard({ hit, locale }: BusinessCardProps) {
  const { formatNumber } = createFormatters(locale);
  const categoryName = pickLocalized(hit.primaryCategoryName, locale);
  const cityName = pickLocalized(hit.cityName, locale);
  return (
    <article
      data-testid="business-card"
      className="group overflow-hidden rounded-lg border border-border-subtle bg-surface transition-colors hover:border-primary"
    >
      <Link href={`/business/${hit.slug}`} className="block">
        <div className="flex aspect-[16/9] items-center justify-center bg-surface-alt">
          {hit.thumbUrl !== null ? (
            // Raw <img>: media URLs are same-origin proxies (/media/…), not
            // Next images; the optimizer round-trip is skipped for
            // user-generated content (B2.7 pattern). eslint-plugin-next is
            // intentionally not configured in this repo.
            <img
              src={hit.thumbUrl}
              alt={hit.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-3xl text-muted">
              ⌂
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-4">
          <h3 className="line-clamp-1 text-base font-semibold text-text">
            {hit.name}
            {hit.isFeatured ? (
              <span aria-hidden className="ms-1 text-accent">
                ★
              </span>
            ) : null}
          </h3>
          <p className="line-clamp-1 text-sm text-muted">
            {[categoryName, cityName].filter((s) => s !== '').join(' · ')}
          </p>
          <div className="flex items-center gap-2">
            <Rating value={hit.avgRating} size="sm" readOnly />
            <span className="text-xs tabular-nums text-muted">{formatNumber(hit.reviewCount)}</span>
          </div>
          <span className="line-clamp-1 text-xs text-muted">{hit.address}</span>
        </div>
      </Link>
    </article>
  );
}
