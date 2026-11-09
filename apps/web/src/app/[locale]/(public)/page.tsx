import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetchServer } from '@/lib/api/server';
import { pickLocalized } from '@/lib/localized';
import { BusinessCard } from '@/components/business/business-card';
import { HomeSearch } from '@/components/search/home-search';
import { accentClass, iconComponent } from '@/components/ui/category-icon';
import {
  publicCategoryNodeSchema,
  searchResultSchema,
  publicCitySchema,
  type PublicCategoryNode,
  type SearchHit,
  type PublicCity,
} from '@app/contracts';
import { z } from 'zod';

/**
 * The map-centric home page (F3.3). DESIGN.md §1: NOT list-first — the hero
 * carries the search box + personal/trending layers, then the category grid
 * (the discovery shortcuts), then the city chips, then the top-rated
 * businesses grid (`GET /search?sort=rating` — the B3.2 ranking; a dedicated
 * `isFeatured` filter is a Follow-up, the ★ badge renders on featured hits
 * the search already marks).
 *
 * Every section degrades independently: an API failure hides THAT section
 * (server components catch their own fetch error) — the page never goes
 * blank because one upstream endpoint is down.
 *
 * Server-side data: `apiFetchServer` (cookies forwarded, schema-validated).
 */

type FetchResult<T> = { ok: true; data: T } | { ok: false };

async function fetchSafe<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { query?: Record<string, string | number> } = {},
): Promise<FetchResult<T>> {
  try {
    const { data } = await apiFetchServer(path, schema, options);
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

export default async function HomePage() {
  const t = await getTranslations('home');
  const tA11y = await getTranslations('a11y');
  const locale = await getLocale();

  // The default city scopes the home suggest (B3.3 cityId) — its slug comes
  // from the cities list's isDefault row (B2.1/B2.10 seed: Tehran).
  const [categories, cities, featured] = await Promise.all([
    fetchSafe('/categories', z.object({ items: z.array(publicCategoryNodeSchema) })),
    fetchSafe('/cities', z.object({ items: z.array(publicCitySchema) })),
    fetchSafe('/search', searchResultSchema, { query: { sort: 'rating', pageSize: 8 } }),
  ]);

  const cityList: PublicCity[] = cities.ok ? cities.data.items : [];
  const defaultCity = cityList.find((c) => c.isDefault) ?? null;
  const featuredHits: SearchHit[] = featured.ok ? featured.data.items : [];

  return (
    <main
      id="main"
      aria-label={tA11y('mainContent')}
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6"
    >
      {/* ── hero: search-first (DESIGN.md — map/discovery, not list-first) ── */}
      <section
        aria-labelledby="home-hero"
        className="flex flex-col items-center gap-5 pt-6 text-center"
      >
        <h1 id="home-hero" className="text-3xl font-semibold text-text sm:text-4xl">
          {t('hero.title')}
        </h1>
        <p className="max-w-prose text-base leading-relaxed text-muted">{t('hero.subtitle')}</p>
        <HomeSearch cityId={defaultCity?.id} />
      </section>

      {/* ── category grid (B2.2 public tree, roots only — leaves live in F3.5) ── */}
      {categories.ok ? (
        <section aria-labelledby="home-categories" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 id="home-categories" className="text-xl font-semibold text-text">
              {t('categories.title')}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {categories.data.items.map((node: PublicCategoryNode) => {
              const Icon = iconComponent(node.icon);
              return (
                <Link
                  key={node.id}
                  href={`/category/${node.slug}`}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-center transition-colors hover:border-primary"
                  data-testid="category-card"
                >
                  {Icon ? (
                    <Icon aria-hidden className={`h-7 w-7 ${accentClass(node.color)}`} />
                  ) : (
                    <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
                  )}
                  <span className="text-sm font-medium text-text">
                    {pickLocalized(node.name, locale)}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── city chips (B2.1 public cities) ────────────────────────────────── */}
      {cityList.length > 0 ? (
        <section aria-labelledby="home-cities" className="flex flex-col gap-3">
          <h2 id="home-cities" className="text-xl font-semibold text-text">
            {t('cities.title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {cityList.map((city) => (
              <Link
                key={city.id}
                href={`/city/${city.slug}`}
                className="rounded-full border border-border-subtle bg-surface px-4 py-1.5 text-sm text-text transition-colors hover:border-primary hover:text-primary"
                data-testid="city-chip"
              >
                {pickLocalized(city.name, locale)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── top-rated grid (B3.2 search, rating sort) ──────────────────────── */}
      {featuredHits.length > 0 ? (
        <section aria-labelledby="home-featured" className="flex flex-col gap-4">
          <h2 id="home-featured" className="text-xl font-semibold text-text">
            {t('featured.title')}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featuredHits.map((hit) => (
              <BusinessCard key={hit.id} hit={hit} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
