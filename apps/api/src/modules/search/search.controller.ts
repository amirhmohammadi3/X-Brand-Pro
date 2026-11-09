import { Controller, Get, Query, type PipeTransform } from '@nestjs/common';
import { searchQuerySchema, type SearchQuery } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchService } from './search.service.js';

/** Array query params that may arrive comma-separated (`?categoryIds=a,b`).
 * Express's qs parser already turns repeat-key (`?categoryIds=a&categoryIds=b`)
 * into an array; this list covers the comma form which is what most HTTP
 * clients emit by default for multi-value query params. */
const ARRAY_QUERY_KEYS = ['categoryIds', 'amenityIds', 'tags'] as const;

/**
 * Pre-transforms comma-separated array query params into real arrays before
 * the Zod schema (which expects `z.array(...)`) validates them. Runs BEFORE
 * `ZodValidationPipe` in the `@Query(...)` pipe chain.
 */
class SplitArrayQueryPipe implements PipeTransform {
  transform(value: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...value };
    for (const key of ARRAY_QUERY_KEYS) {
      const v = out[key];
      if (typeof v === 'string') {
        out[key] = v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    }
    return out;
  }
}

/**
 * Public business search endpoint (B3.2). `GET /api/v1/search` accepts a
 * free-text `q` plus facet filters and a geo origin, returns ranked, paginated
 * hits. Only `active`, non-soft-deleted businesses are returned.
 *
 * Array query params accept either `?categoryIds=a,b` (comma form, split by
 * `SplitArrayQueryPipe`) or `?categoryIds=a&categoryIds=b` (repeat-key form,
 * already an array from Express's qs parser). Both feed `z.array(uuidSchema)`.
 *
 * Rate-limited per IP — search is anonymous and touches the tsvector GIN +
 * PostGIS GiST indexes on every request. The response is the success envelope
 * `{ items: SearchHit[], meta: PageMeta }` per AGENTS.md §6.
 */
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get('search')
  @RateLimit({ name: 'search.read', limit: 60, windowSec: 60 })
  async runSearch(
    @Query(new SplitArrayQueryPipe(), new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ) {
    return this.search.search(query);
  }
}
