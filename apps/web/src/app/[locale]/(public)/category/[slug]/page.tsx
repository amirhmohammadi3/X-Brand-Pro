import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetchServer } from '@/lib/api/server';
import { pickLocalized } from '@/lib/localized';
import { BusinessCard } from '@/components/business/business-card';
import { accentClass, iconComponent } from '@/components/ui/category-icon';
import { searchResultSchema, type CategoryAccent, type SearchHit } from '@app/contracts';
import { z } from 'zod';

/**
 * Category landing page (F3.5) — SEO surface for `/{locale}/category/[slug]`:
 * H1 = the localized category name, the description, the child-category chips
 * (deeper level → this same page type), the top businesses in the category
 * (B3.2 `sort=rating`), and a prominent «روی نقشه» CTA that lands the user on
 * the map-search page PRE-FILTERED (`/search?categoryIds=…` — F3.4's
 * shareable-URL contract).
 *
 * `generateMetadata` carries the localized title/description — the category
 * tree is server-cached by the API (60s) so the metadata is cheap.
 */

const categoryDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).nullable(),
  icon: z.string(),
  color: z.string().nullable(),
  kind: z.enum(['menu', 'services', 'none']),
  supportsReservation: z.boolean(),
  children: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.record(z.string(), z.string()),
      description: z.record(z.string(), z.string()).nullable(),
      icon: z.string(),
      color: z.string().nullable(),
      kind: z.enum(['menu', 'services', 'none']),
      supportsReservation: z.boolean(),
    }),
  ),
  parent: z
    .object({ slug: z.string(), name: z.record(z.string(), z.string()) })
    .nullable()
    .optional(),
});

type CategoryDetail = z.infer<typeof categoryDetailSchema>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const { data } = await apiFetchServer(`/categories/${slug}`, categoryDetailSchema);
    const name = pickLocalized(data.name, locale);
    const description = pickLocalized(data.description, locale);
    return {
      title: name !== '' ? name : slug,
      description: description !== '' ? description : undefined,
    };
  } catch {
    return { title: slug };
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations('listing');

  let category: CategoryDetail | null = null;
  let hits: SearchHit[] = [];
  try {
    // The category detail FIRST — the search needs its UUID (`categoryIds`
    // is a uuid[] facet, not a slug list).
    const catRes = await apiFetchServer(`/categories/${slug}`, categoryDetailSchema);
    category = catRes.data;
    const bizRes = await apiFetchServer('/search', searchResultSchema, {
      query: { categoryIds: category.id, sort: 'rating', pageSize: 12 },
    });
    hits = bizRes.data.items;
  } catch {
    // One of the two fetches failed — fall through to the not-found branch.
  }

  if (category === null) {
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

  const name = pickLocalized(category.name, locale);
  const description = pickLocalized(category.description, locale);
  const Icon = iconComponent(category.icon);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      {/* breadcrumb (parent first) */}
      {category.parent ? (
        <nav aria-label={t('breadcrumb')} className="text-sm text-muted">
          <Link href={`/category/${category.parent.slug}`} className="hover:text-primary">
            {pickLocalized(category.parent.name, locale)}
          </Link>
          <span aria-hidden className="mx-2">
            /
          </span>
          <span className="text-text">{name}</span>
        </nav>
      ) : null}

      <header className="flex items-center gap-4">
        {Icon ? (
          <Icon
            aria-hidden
            className={`h-10 w-10 ${accentClass(category.color as CategoryAccent | null)}`}
          />
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold text-text sm:text-3xl">{name}</h1>
          {description !== '' ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        <Link
          href={{ pathname: '/search', query: { categoryIds: category.id } }}
          className="ms-auto rounded-full bg-primary px-4 py-2 text-sm text-on-primary"
          data-testid="listing-map-cta"
        >
          {t('viewOnMap')}
        </Link>
      </header>

      {category.children.length > 0 ? (
        <section aria-label={t('subcategories')} className="flex flex-wrap gap-2">
          {category.children.map((child) => (
            <Link
              key={child.id}
              href={`/category/${child.slug}`}
              className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-sm text-text hover:border-primary"
              data-testid="subcategory-chip"
            >
              {pickLocalized(child.name, locale)}
            </Link>
          ))}
        </section>
      ) : null}

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
