import { Injectable } from '@nestjs/common';
import { normalizePersianText, normalizeDigits } from '@app/contracts';
import type {
  NormalizedSuggestQuery,
  SuggestHit,
  SuggestQuery,
  SuggestResult,
} from '@app/contracts';
// CacheService is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
// SuggestRepository is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SuggestRepository } from './suggest.repository.js';

/** Cache TTL for suggest results. Typeahead traffic is bursty and a 60s
 * staleness window is acceptable (a new business appears within a minute of
 * going active). Matches the categories-tree cache TTL for consistency. */
const SUGGEST_CACHE_TTL_SEC = 60;

/**
 * Suggest service (B3.3). Normalises the validated `SuggestQuery` into a
 * `NormalizedSuggestQuery`, then serves the result from Redis via
 * `CacheService.wrap` (read-through; degrades to a miss on Redis failure).
 *
 * Normalisation applied to `q` before it reaches the trigram ILIKE / similarity:
 * - `normalizePersianText` (Arabic ي→ی/ك→ک, tatweel/diacritics stripped, ZWNJ
 *   + whitespace unified) — so the prefix canonical form matches the
 *   pre-normalised `name_normalized` / `name_fa` columns.
 * - `normalizeDigits` (Persian/Arabic-Indic → ASCII).
 * - Latin lowercasing — `name_fa` is the raw localized map's `fa` value, which
 *   is Persian (no case), but Latin business names (`"Tehran Cafe"`) are stored
 *   verbatim; lowercasing the prefix matches an ILIKE on a case-insensitive
 *   column.
 * - SQL-wildcard escape (`%`, `_`, `\` → backslash-escaped) so the prefix is a
 *   literal ILIKE pattern, not a user-controlled glob.
 *
 * For `scope=all`, the four scopes are fetched in parallel and merged: deduped
 * by `(kind, id)` (a business that is also a category slug is impossible, but
 * the dedup is cheap defence), ordered by score desc, then capped to `limit`.
 */
@Injectable()
export class SuggestService {
  constructor(
    private readonly repo: SuggestRepository,
    private readonly cache: CacheService,
  ) {}

  async suggest(query: SuggestQuery): Promise<SuggestResult> {
    const normalized = this.normalize(query);
    if (normalized.prefix.length === 0) return { items: [] };

    const cacheKey = this.cacheKey(normalized);
    const items = await this.cache.wrap<SuggestHit[]>(cacheKey, SUGGEST_CACHE_TTL_SEC, async () =>
      this.fetch(normalized),
    );
    return { items };
  }

  /** Pure mapping — extracted so it is unit-testable without a DB/Redis. */
  normalize(query: SuggestQuery): NormalizedSuggestQuery {
    return {
      prefix: this.normalizePrefix(query.q),
      scope: query.scope,
      cityId: query.cityId,
      limit: query.limit,
    };
  }

  /** Pure cache-key builder — extracted for unit testing. */
  cacheKey(q: NormalizedSuggestQuery): string {
    // Include every dimension that changes the result set so two different
    // queries never share a cache entry. `prefix` is already normalised.
    return `suggest:${q.scope}:${q.cityId ?? 'all'}:${q.limit}:${q.prefix}`;
  }

  /** Normalise the raw prefix: Persian/Arabic char mapping + digits + Latin
   * lowercase + SQL-wildcard escape. Returns '' for empty/whitespace input. */
  private normalizePrefix(raw: string): string {
    const t = normalizePersianText(normalizeDigits(raw)).toLowerCase();
    // Escape ILIKE wildcards so the prefix is literal. `\` must be escaped
    // first (it is the escape char itself in LIKE/ILIKE).
    return t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  /** Fetch from the repository — single scope or the merged `all` bag. */
  private async fetch(q: NormalizedSuggestQuery): Promise<SuggestHit[]> {
    if (q.scope !== 'all') return this.fetchScope(q, q.scope);
    // Parallel fetch across all four scopes; Promise.all preserves order but
    // we re-sort by score after merge anyway.
    const [businesses, categories, neighborhoods, cities] = await Promise.all([
      this.fetchScope(q, 'business'),
      this.fetchScope(q, 'category'),
      this.fetchScope(q, 'neighborhood'),
      this.fetchScope(q, 'city'),
    ]);
    const merged = [...businesses, ...categories, ...neighborhoods, ...cities];
    // Dedupe by kind+id (defence — scopes are disjoint by kind, so this is a
    // no-op in practice, but cheap insurance against future cross-scope hits).
    const seen = new Set<string>();
    const deduped = merged.filter((h) => {
      const key = `${h.kind}:${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Sort by score desc, then by kind for stable grouping, then slug.
    deduped.sort((a, b) =>
      b.score - a.score !== 0
        ? b.score - a.score
        : a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug),
    );
    return deduped.slice(0, q.limit);
  }

  private fetchScope(
    q: NormalizedSuggestQuery,
    scope: 'business' | 'category' | 'neighborhood' | 'city',
  ): Promise<SuggestHit[]> {
    switch (scope) {
      case 'business':
        return this.repo.suggestBusinesses(q);
      case 'category':
        return this.repo.suggestCategories(q);
      case 'neighborhood':
        return this.repo.suggestNeighborhoods(q);
      case 'city':
        return this.repo.suggestCities(q);
    }
  }
}
