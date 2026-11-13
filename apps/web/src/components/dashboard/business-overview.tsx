'use client';

/**
 * BusinessOverview (F7.1) — the `/dashboard/:businessId` body.
 *
 * Server-pre-fetched: the parent page passes the business detail (ownership
 * already gated by the API) and the B7.2 stats (best-effort — null when the
 * business has no events yet). Renders a header (cover, name, status badge,
 * city · category, «view public page» link), a row of stat cards for the
 * five measurable event types, and a short «what you can do here» panel that
 * points at the section sidebar. F7.8 swaps the stat row for the full charts
 * dashboard; F7.2–F7.6 fill the section pages the sidebar links to.
 */
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ExternalLink, Eye, Layers, MapPin, Phone, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  ANALYTICS_EVENT_TYPES,
  AnalyticsStatsResult,
  BusinessDetail,
  BusinessStatus,
} from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { pickLocalized } from '../../lib/localized';
import { dashboardNavGroups } from '../../lib/dashboard-nav';
import { Badge, Card, CardBody, CardHeader, Heading, Rating, Stat } from '../ui';

const STATUS_BADGE_VARIANT: Record<BusinessStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  pending: 'warning',
  active: 'success',
  suspended: 'warning',
  rejected: 'danger',
  closed: 'neutral',
};

/** Stat-card descriptor per event type — order is the funnel (view → click). */
const EVENT_CARDS: ReadonlyArray<{
  type: (typeof ANALYTICS_EVENT_TYPES)[number];
  icon: LucideIcon;
  labelKey: string;
}> = [
  { type: 'business_view', icon: Eye, labelKey: 'business.stats.views' },
  { type: 'call_click', icon: Phone, labelKey: 'business.stats.calls' },
  { type: 'direction_click', icon: MapPin, labelKey: 'business.stats.directions' },
  { type: 'share_click', icon: Share2, labelKey: 'business.stats.shares' },
  { type: 'impression', icon: Layers, labelKey: 'business.stats.impressions' },
];

export function BusinessOverview({
  business,
  stats,
}: {
  business: BusinessDetail;
  stats: AnalyticsStatsResult | null;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);

  const cityName = pickLocalized(business.city.name, locale);
  const categoryName = pickLocalized(business.primaryCategory.name, locale);
  const placeLine = [categoryName, cityName].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
        <div className="flex aspect-[3/1] items-center justify-center bg-surface-alt">
          {business.coverUrl !== null ? (
            <img
              src={business.coverUrl}
              alt={business.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-4xl text-muted">
              ⌂
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-text">{business.name}</h1>
              <Badge variant={STATUS_BADGE_VARIANT[business.status]}>
                {t(`business.status.${business.status}`)}
              </Badge>
            </div>
            {placeLine && <p className="text-sm text-text-subtle">{placeLine}</p>}
            <div className="flex items-center gap-2 pt-1">
              <Rating value={business.avgRating} size="sm" readOnly />
              <span className="text-xs text-muted">{formatNumber(business.reviewCount)}</span>
            </div>
          </div>
          <Link
            href={`/business/${business.slug}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t('business.viewPublic')}
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      {/* Stat cards (B7.2 owner read). */}
      <section aria-label={t('business.stats.title')}>
        <Heading level="h2" className="mb-3 text-lg">
          {t('business.stats.title')}
        </Heading>
        {stats === null ? (
          <Card>
            <CardBody>
              <p className="text-sm text-text-subtle">{t('business.stats.empty')}</p>
            </CardBody>
          </Card>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            data-testid="business-stat-grid"
          >
            {EVENT_CARDS.map(({ type, icon: Icon, labelKey }) => (
              <li key={type}>
                <Stat
                  label={t(labelKey)}
                  value={formatNumber(stats.totals[type] ?? 0)}
                  icon={<Icon className="size-4" aria-hidden />}
                />
              </li>
            ))}
          </ul>
        )}
        {stats && (
          <p className="mt-2 text-xs text-muted">
            {t('business.stats.window', { from: stats.from, to: stats.to })}
          </p>
        )}
      </section>

      {/* What lives here — points at the sidebar (sections fill in F7.2–F7.8). */}
      <Card>
        <CardHeader>
          <Heading level="h2" className="text-base">
            {t('business.sections.title')}
          </Heading>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-text-subtle">{t('business.sections.description')}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {dashboardNavGroups(business.id)
              .flatMap((group) => group.items)
              .filter((item) => item.key !== 'overview')
              .map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm"
                >
                  <span className="text-text">{t(`nav.${item.labelKey}`)}</span>
                  {item.available ? (
                    <Link href={item.href} className="text-primary hover:underline">
                      {t('business.sections.open')}
                    </Link>
                  ) : (
                    <Badge variant="neutral">{t('nav.soon')}</Badge>
                  )}
                </li>
              ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
