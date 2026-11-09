import { Injectable } from '@nestjs/common';
import { normalizePersianText, normalizeDigits } from '@app/contracts';
import type { NormalizedSearchQuery, SearchQuery, SearchSort } from '@app/contracts';
// SearchRepository is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchRepository } from './search.repository.js';

/**
 * Search service (B3.2). Normalizes the validated `SearchQuery` into a
 * `NormalizedSearchQuery` the repository consumes, then calls the repository.
 *
 * Normalization applied to `q` before it reaches the tsquery:
 * - `normalizePersianText` (Arabic ي→ی/ك→ک, tatweel/diacritics stripped, ZWNJ
 *   and whitespace unified) — so the query canonical form matches the
 *   pre-normalized `businesses.name_normalized` / generated tsvector.
 * - `normalizeDigits` (Persian/Arabic-Indic → ASCII) — so "کافه ۲" matches
 *   "کافه 2".
 *
 * The default sort resolves here: `relevance` when a text query is present,
 * `rating` otherwise. `distance` requires the geo origin (enforced upstream by
 * the schema refine), and is left as-is when explicitly chosen.
 */
@Injectable()
export class SearchService {
  constructor(private readonly repo: SearchRepository) {}

  async search(query: SearchQuery) {
    const normalized = this.normalize(query);
    const { items, total } = await this.repo.searchBusinesses(normalized);
    const totalPages = Math.ceil(total / normalized.limit) || 0;
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    };
  }

  /** Pure mapping — extracted so it is unit-testable without a DB. */
  normalize(query: SearchQuery): NormalizedSearchQuery {
    const qNorm = query.q ? normalizePersianText(normalizeDigits(query.q)) : null;
    const sort = this.resolveSort(query.sort, qNorm);
    return {
      q: qNorm && qNorm.length > 0 ? qNorm : null,
      cityId: query.cityId,
      neighborhoodId: query.neighborhoodId,
      categoryIds: query.categoryIds,
      amenityIds: query.amenityIds,
      tags: query.tags,
      priceLevel: query.priceLevel,
      minRating: query.minRating,
      lat: query.lat,
      lng: query.lng,
      radius: query.radius,
      sort,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    };
  }

  private resolveSort(sort: SearchSort | undefined, q: string | null): SearchSort {
    if (sort) return sort;
    // relevance is only meaningful with a text query; otherwise fall back to
    // rating (the most useful "best of" ordering for a facet-only search).
    return q ? 'relevance' : 'rating';
  }
}
