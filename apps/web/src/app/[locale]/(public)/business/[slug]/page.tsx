import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Navigation } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { apiFetchServer } from '@/lib/api/server';
import { pickLocalized } from '@/lib/localized';
import { createFormatters } from '@/lib/format';
import { directionsUrl } from '@/lib/business-links';
import { Rating, Badge, Separator } from '@/components/ui';
import { BusinessHours, OPEN_STATE_META } from '@/components/business/business-hours';
import { BusinessContacts } from '@/components/business/business-contacts';
import { BusinessMap } from '@/components/business/business-map';
import { BusinessGallery } from '@/components/business/business-gallery';
import { BusinessMenu } from '@/components/business/business-menu';
import { businessPageSchema, type BusinessPage } from '@app/contracts';

/**
 * Public business page (F4.1) — `/[locale]/business/[slug]`. The ONE read is
 * the B4.9 aggregate (`GET /businesses/:idOrSlug/page`): detail + hours +
 * open-now status + gallery + menu + first reviews page + question count +
 * schema.org JSON-LD, composed from already-public services (the visibility
 * gate is the detail GET's — active for guests, non-active → owner/admin
 * only, 404 otherwise; existence is never leaked).
 *
 * F4.1 renders the hero (cover, name, rating, claimed badge, open-now pill,
 * category/neighborhood/city, address, tags), the info section (description,
 * amenities, categories), the weekly hours table, the single-point map with a
 * directions CTA, and the contact channels. Gallery/menu/reviews/Q&A render
 * in their own prompts (F4.2–F4.7); the JSON-LD the aggregate already
 * returned is injected verbatim for SEO.
 *
 * `generateMetadata` carries the localized title/description. The aggregate is
 * server-cached by the API (60s) so the double fetch (metadata + body) is
 * cheap — same pattern as the F3.5 category page.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { data } = await apiFetchServer(`/businesses/${slug}/page`, businessPageSchema);
    return {
      title: data.business.name,
      description: data.business.description ?? undefined,
    };
  } catch {
    return { title: slug };
  }
}

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations('businessPage');
  const tA11y = await getTranslations('a11y');
  const { formatNumber } = createFormatters(locale);

  let page: BusinessPage | null = null;
  try {
    const res = await apiFetchServer(`/businesses/${slug}/page`, businessPageSchema);
    page = res.data;
  } catch {
    // 404 / inactive / network — fall through to the not-found block.
  }

  if (!page) {
    return (
      <main
        id="main"
        aria-label={tA11y('mainContent')}
        className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 px-4 py-16 text-center"
      >
        <h1 className="text-2xl font-semibold text-text">{t('notFound.title')}</h1>
        <p className="text-sm text-muted">{t('notFound.body')}</p>
        <Link href="/" className="text-sm text-primary underline underline-offset-4">
          {t('notFound.backHome')}
        </Link>
      </main>
    );
  }

  const { business, hours, photos, menu, jsonLd } = page;
  const categoryName = pickLocalized(business.primaryCategory.name, locale);
  const cityName = pickLocalized(business.city.name, locale);
  const neighborhoodName = business.neighborhood
    ? pickLocalized(business.neighborhood.name, locale)
    : '';
  const coverUrl = business.coverUrl ?? business.thumbUrl ?? null;
  const openMeta = OPEN_STATE_META[hours.openStatus.state];
  const placeLine = [categoryName, neighborhoodName, cityName].filter((s) => s !== '').join(' · ');
  const reviewsLabel =
    business.reviewCount > 0
      ? t('reviewsCount', { count: formatNumber(business.reviewCount) })
      : t('noReviews');

  return (
    <main
      id="main"
      aria-label={tA11y('mainContent')}
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6"
    >
      {/* breadcrumb: home / city / category / current */}
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted">
        <Link href="/" className="hover:text-primary">
          {cityName !== '' ? cityName : t('notFound.backHome')}
        </Link>
        <span aria-hidden className="mx-2">
          /
        </span>
        <Link href={`/category/${business.primaryCategory.slug}`} className="hover:text-primary">
          {categoryName}
        </Link>
        <span aria-hidden className="mx-2">
          /
        </span>
        <span className="text-text">{business.name}</span>
      </nav>

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="business-hero"
        className="overflow-hidden rounded-xl border border-border-subtle bg-surface"
        data-testid="business-hero"
      >
        {coverUrl !== null ? (
          <div className="aspect-[16/9] w-full bg-surface-alt">
            {/* Raw <img>: media URLs are same-origin /media proxies, not Next
             * images — the optimizer round-trip is skipped for user content
             * (B2.7 pattern, same as BusinessCard). */}
            <img
              src={coverUrl}
              alt={t('coverAlt', { name: business.name })}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 id="business-hero" className="text-2xl font-semibold text-text sm:text-3xl">
                {business.name}
              </h1>
              {business.nameAlt ? <p className="text-sm text-muted">{business.nameAlt}</p> : null}
            </div>
            <Badge
              variant={business.isClaimed ? 'success' : 'neutral'}
              data-testid="business-claimed-badge"
            >
              {t(business.isClaimed ? 'claimed' : 'unclaimed')}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Rating value={business.avgRating} readOnly />
            <span className="text-sm tabular-nums text-muted">{reviewsLabel}</span>
            <Badge variant={openMeta.variant} data-testid="business-open-badge">
              {t(openMeta.labelKey)}
            </Badge>
          </div>

          {placeLine !== '' ? <p className="text-sm text-muted">{placeLine}</p> : null}
          <p className="text-sm text-muted">{business.address}</p>

          {business.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" data-testid="business-tags">
              {business.tags.map((tag) => (
                <Badge key={tag} variant="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* ── gallery (F4.2) ──────────────────────────────────────────────── */}
      {photos.length > 0 ? (
        <section aria-labelledby="business-gallery" className="flex flex-col gap-3">
          <h2 id="business-gallery" className="text-xl font-semibold text-text">
            {t('gallery.title')}
          </h2>
          <BusinessGallery photos={photos} />
        </section>
      ) : null}

      {/* ── info: description + amenities + categories ───────────────────── */}
      {business.description !== null ||
      business.amenities.length > 0 ||
      business.categories.length > 0 ? (
        <section aria-labelledby="business-info" className="flex flex-col gap-4">
          <h2 id="business-info" className="text-xl font-semibold text-text">
            {t('sections.info')}
          </h2>
          {business.description !== null ? (
            <p className="text-sm leading-relaxed text-text">{business.description}</p>
          ) : null}
          {business.amenities.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted">{t('amenities')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {business.amenities.map((a) => (
                  <Badge key={a.id} variant="neutral">
                    {pickLocalized(a.name, locale)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {business.categories.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted">{t('categories')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {business.categories.map((c) => (
                  <Link
                    key={c.id}
                    href={`/category/${c.slug}`}
                    className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-xs text-text transition-colors hover:border-primary hover:text-primary"
                  >
                    {pickLocalized(c.name, locale)}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── menu / services (F4.3) ─────────────────────────────────────── */}
      <section aria-labelledby="business-menu" className="flex flex-col gap-3">
        <h2 id="business-menu" className="text-xl font-semibold text-text">
          {t('menu.title')}
        </h2>
        <BusinessMenu menu={menu} locale={locale} />
      </section>

      <Separator />

      {/* ── hours ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="business-hours" className="flex flex-col gap-3">
        <h2 id="business-hours" className="text-xl font-semibold text-text">
          {t('sections.hours')}
        </h2>
        <BusinessHours hours={hours} locale={locale} />
      </section>

      <Separator />

      {/* ── map + directions ──────────────────────────────────────────────── */}
      <section aria-labelledby="business-map" className="flex flex-col gap-3">
        <h2 id="business-map" className="text-xl font-semibold text-text">
          {t('sections.map')}
        </h2>
        <BusinessMap
          lng={business.location.lng}
          lat={business.location.lat}
          ariaLabel={t('mapAria')}
        />
        <a
          href={directionsUrl(business.location.lat, business.location.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          data-testid="business-directions"
        >
          <Navigation aria-hidden className="h-4 w-4" />
          {t('contact.directions')}
        </a>
      </section>

      <Separator />

      {/* ── contacts ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="business-contact" className="flex flex-col gap-3">
        <h2 id="business-contact" className="text-xl font-semibold text-text">
          {t('sections.contact')}
        </h2>
        <BusinessContacts business={business} locale={locale} />
      </section>

      {/* schema.org JSON-LD (B4.9 builder) — injected verbatim for SEO. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
