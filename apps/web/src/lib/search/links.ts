// src/lib/search/links.ts — deep-link builders for search surfaces (F3.6).
//
// Locale prefix rules live in ONE helper: `fa` is UNPREFIXED (as-needed,
// src/i18n/routing.ts) and every other locale gets `/{locale}/…` — the same
// rule MapLibre popup HTML (raw HTML, not the next-intl <Link>) must follow.
//
// Suggest hits land on the MAP-SEARCH page (`/search`) with the matching
// query param — the universal target while phase 3 is in flight. F3.5 (city/
// category pages) and F4.1 (business page) will override the business/
// category/city cases here, in ONE place, when those pages exist.
import type { SuggestHit } from '@app/contracts';

/** Locale-aware href: `fa` unprefixed, others `/{locale}/…`. */
export function buildLocaleHref(locale: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return locale === 'fa' ? suffix : `/${locale}${suffix}`;
}

export type SuggestHitTarget =
  | { kind: 'search'; path: '/search'; query: Record<string, string> }
  | { kind: 'route'; path: string };

/** Build the navigation target for a suggest hit (see the module docstring). */
export function buildSuggestHitTarget(hit: SuggestHit): SuggestHitTarget | null {
  switch (hit.kind) {
    case 'business':
      // F4.1 will replace this with the /business/:slug route (one-line change here).
      return { kind: 'search', path: '/search', query: { q: hit.label } };
    case 'category':
      return { kind: 'search', path: '/search', query: { categoryIds: hit.id } };
    case 'neighborhood':
      return { kind: 'search', path: '/search', query: { neighborhoodId: hit.id } };
    case 'city':
      return { kind: 'search', path: '/search', query: { cityId: hit.id } };
    default:
      return null;
  }
}
