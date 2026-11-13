'use client';

/**
 * DashboardOverview (F7.1) — the `/dashboard` body.
 *
 * Lists every business the caller owns (`GET /businesses/me`, every status)
 * as cards that link into the per-business dashboard `/dashboard/:id`. The
 * list is the `useMyBusinesses()` TanStack query (shared with the shell's
 * selector), so a registration lands here in one refetch.
 *
 * States: loading (spinner), empty (CTA to the registration wizard), error
 * (ErrorState), populated (card grid). Cards carry the summary's cover/thumb,
 * name, city + primary category, rating + review count and a «manage»
 * affordance — the canonical public-business card grammar, but linking into
 * the dashboard instead of the public page.
 */
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ArrowLeft, Plus, Store } from 'lucide-react';
import type { BusinessSummary } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { pickLocalized } from '../../lib/localized';
import { useMyBusinesses } from '../../lib/api/businesses';
import { Badge, Button, EmptyState, ErrorState, Rating, Spinner } from '../ui';
import { cn } from '../../lib/cn';

export function DashboardOverview() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const { formatNumber } = createFormatters(locale);
  const { businesses, isPending, error } = useMyBusinesses();

  if (isPending) {
    return (
      <div className="flex items-center gap-2 text-text-subtle">
        <Spinner size="sm" aria-label={t('loading')} />
        <span className="text-sm">{t('loading')}</span>
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  const registerHref = '/business/new';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-subtle">{t('overview.subtitle')}</p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href={registerHref}>
            <Plus className="size-4" aria-hidden />
            {t('overview.register')}
          </Link>
        </Button>
      </header>

      {businesses.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t('overview.empty.title')}
          description={t('overview.empty.description')}
          action={{
            label: t('overview.register'),
            onClick: () => router.push(registerHref),
            variant: 'secondary',
          }}
        />
      ) : (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="dashboard-business-grid"
        >
          {businesses.map((b) => (
            <DashboardBusinessCard
              key={b.id}
              business={b}
              locale={locale}
              formatNumber={formatNumber}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DashboardBusinessCard({
  business,
  locale,
  formatNumber,
}: {
  business: BusinessSummary;
  locale: string;
  formatNumber: (n: number) => string;
}) {
  const t = useTranslations('dashboard');
  const cityName = pickLocalized(business.city.name, locale);
  const categoryName = pickLocalized(business.primaryCategory.name, locale);
  return (
    <li>
      <Link
        href={`/dashboard/${business.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface transition-colors hover:border-primary"
        data-testid="dashboard-business-card"
      >
        <div className="flex aspect-[16/9] items-center justify-center bg-surface-alt">
          {business.thumbUrl !== null ? (
            // Raw <img>: media URLs are same-origin proxies (/media/…).
            <img
              src={business.thumbUrl}
              alt={business.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-3xl text-muted">
              ⌂
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-1 text-base font-medium text-text">{business.name}</h2>
            {!business.isClaimed && (
              <Badge variant="warning" className="shrink-0">
                {t('overview.unclaimed')}
              </Badge>
            )}
          </div>
          {(cityName || categoryName) && (
            <p className="line-clamp-1 text-sm text-text-subtle">
              {[categoryName, cityName].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <Rating value={business.avgRating} size="sm" readOnly />
              <span className="text-xs text-muted">{formatNumber(business.reviewCount)}</span>
            </div>
            <span
              className={cn(
                'flex items-center gap-1 text-sm text-text-subtle',
                'group-hover:text-primary',
              )}
            >
              {t('overview.manage')}
              <ArrowLeft className="size-4" aria-hidden />
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
