import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetchServer } from '@/lib/api/server';
import { pickLocalized } from '@/lib/localized';
import { BusinessCard } from '@/components/business/business-card';
import { PopularQueries } from '@/components/search/popular-queries';
import {
  publicCitySchema,
  neighborhoodSchema,
  searchResultSchema,
  type SearchHit,
  type PublicCity,
  type Neighborhood,
} from '@app/contracts';
import { z } from 'zod';

/**
 * City landing page (F3.5) — SEO surface for `/{locale}/city/[slug]`:
 * H1 = the localized city name, neighborhood chips (→ `/search?cityId=…&
 * neighborhoodId=…`, F3.4's shareable URL), city-scoped popular searches
 * (F3.6's `usePopularQueries` with cityId), the top businesses in the city
 * (B3.2 `sort=rating`), and the «روی نقشه» CTA → `/search?cityId=…`.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const { data } = await apiFetchServer(`/cities/${slug}`, publicCitySchema);
    const name = pickLocalized(data.name, locale);
    return { title: name !== '' ? name : slug };
  } catch {
    return { title: slug };
  }
}

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations('listing');

  let city: PublicCity | null = null;
  let neighborhoods: Neighborhood[] = [];
  let hits: SearchHit[] = [];
  try {
    const cityRes = await apiFetchServer(`/cities/${slug}`, publicCitySchema);
    city = cityRes.data;
    const [neighRes, bizRes] = await Promise.all([
      apiFetchServer(
        `/cities/${slug}/neighborhoods`,
        z.object({ items: z.array(neighborhoodSchema) }),
      ),
      apiFetchServer('/search', searchResultSchema, {
        query: { cityId: city.id, sort: 'rating', pageSize: 12 },
      }),
    ]);
    neighborhoods = neighRes.data.items;
    hits = bizRes.data.items;
  } catch {
    // Any fetch failure → the not-found branch (an unknown slug is a 404 page).
  }

  if (city === null) {
    return (
      <main
        id="main"
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

  const name = pickLocalized(city.name, locale);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text sm:text-3xl">{name}</h1>
          <p className="mt-1 text-sm text-muted">{t('cityTagline')}</p>
        </div>
        <Link
          href={{ pathname: '/search', query: { cityId: city.id } }}
          className="ms-auto rounded-full bg-primary px-4 py-2 text-sm text-on-primary"
          data-testid="listing-map-cta"
        >
          {t('viewOnMap')}
        </Link>
      </header>

      {neighborhoods.length > 0 ? (
        <section aria-label={t('neighborhoods')} className="flex flex-wrap gap-2">
          {neighborhoods.map((n) => (
            <Link
              key={n.id}
              href={{ pathname: '/search', query: { cityId: city.id, neighborhoodId: n.id } }}
              className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-sm text-text hover:border-primary"
              data-testid="neighborhood-chip"
            >
              {pickLocalized(n.name, locale)}
            </Link>
          ))}
        </section>
      ) : null}

      <PopularQueries cityId={city.id} limit={8} />

      <section aria-label={t('businesses')} className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-text">{t('businesses')}</h2>
        {hits.length === 0 ? (
          <p className="text-sm text-muted" data-testid="listing-empty">
            {t('empty')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {hits.map((hit) => (
              <BusinessCard key={hit.id} hit={hit} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
