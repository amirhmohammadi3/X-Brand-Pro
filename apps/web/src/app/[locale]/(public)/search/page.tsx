import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SearchPageClient } from '@/components/search/search-page-client';

/**
 * The map-centric search page (F3.4). The server component parses the URL
 * query (`?q=&cityId=&neighborhoodId=&categoryIds=&minRating=&priceLevel=
 * &sort=`) into the typed initial filters and mounts the client shell
 * (map + results list + filters). The URL is the shareable state — every
 * filter change `router.replace`s a canonical /search URL, so pasted links,
 * category/city chips (F3.5) and the suggest typeahead (F3.6) all land on
 * the exact same filtered view. Pagination is CLIENT state (not URL) — the
 * map re-fires per viewport anyway; the list keeps its own page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('search');
  return {
    title: t('pageTitle'),
    description: t('pageDescription'),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTS = ['relevance', 'rating', 'distance', 'newest'] as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const single = (key: string): string | undefined => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s.length > 0 ? s : undefined;
  };
  const uuid = (key: string): string | undefined => {
    const v = single(key);
    return v !== undefined && UUID_RE.test(v) ? v : undefined;
  };
  const uuidList = (key: string): string[] | undefined => {
    const raw = params[key];
    const s = Array.isArray(raw) ? raw.join(',') : raw;
    if (typeof s !== 'string' || s.length === 0) return undefined;
    const ids = s
      .split(',')
      .map((p) => p.trim())
      .filter((p) => UUID_RE.test(p));
    return ids.length > 0 ? ids.slice(0, 20) : undefined;
  };
  const num = (key: string, min: number, max: number): number | undefined => {
    const v = single(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };

  const sortRaw = single('sort');
  const sort = SORTS.find((s) => s === sortRaw);

  const initialFilters = {
    q: single('q'),
    cityId: uuid('cityId'),
    neighborhoodId: uuid('neighborhoodId'),
    categoryIds: uuidList('categoryIds'),
    amenityIds: uuidList('amenityIds'),
    minRating: num('minRating', 0, 5),
    priceLevel: num('priceLevel', 1, 4),
    sort,
  };

  return <SearchPageClient initialFilters={initialFilters} />;
}
