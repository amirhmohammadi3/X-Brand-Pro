import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  type PipeTransform,
} from '@nestjs/common';
import type { AuthenticatedHttpRequest } from '../auth/jwt-auth.guard.js';
import {
  popularQueriesQuerySchema,
  searchHistoryQuerySchema,
  searchQuerySchema,
  suggestQuerySchema,
  uuidSchema,
  type ClearSearchHistoryResult,
  type PopularQueriesQuery,
  type PopularQueriesResult,
  type SearchHistoryQuery,
  type SearchHistoryResult,
  type SearchQuery,
  type SuggestQuery,
} from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// Value imports: Nest reads the types at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchService } from './search.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SuggestService } from './suggest.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchStatsService } from './search-stats.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TokenService } from '../auth/token.service.js';

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
 * Public business search endpoints (B3.2 + B3.3) and the history/popular
 * endpoints (B3.5). `GET /api/v1/search` accepts a free-text `q` plus facet
 * filters and a geo origin, returns ranked, paginated hits. Only `active`,
 * non-soft-deleted businesses are returned.
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
  constructor(
    private readonly search: SearchService,
    private readonly suggest: SuggestService,
    private readonly stats: SearchStatsService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Get('search')
  @RateLimit({ name: 'search.read', limit: 60, windowSec: 60 })
  async runSearch(
    @Req() req: AuthenticatedHttpRequest,
    @Query(new SplitArrayQueryPipe(), new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ) {
    const result = await this.search.search(query);
    await this.recordStats(req, query, result.meta.total);
    return result;
  }

  /**
   * Best-effort stats recording (B3.5) after a successful text search:
   * popularity counter for every searcher, per-user history only when a valid
   * access token rode along (the global JwtAuthGuard skips @Public routes, so
   * the optional user is resolved here — JWT verification only, no session/
   * status round trips; DECISIONS B3.5). Any failure is swallowed: a stats
   * write must never turn a successful search into a 500.
   */
  private async recordStats(
    req: AuthenticatedHttpRequest,
    query: SearchQuery,
    resultCount: number,
  ): Promise<void> {
    if (!query.q) return;
    try {
      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length).trim()
          : undefined;
      const token = bearer || req.cookies?.at;
      const claims = token ? await this.tokens.verifyAccess(token) : null;
      await this.stats.record({
        userId: claims?.sub ?? null,
        text: query.q,
        cityId: query.cityId ?? null,
        resultCount,
      });
    } catch {
      // Swallowed by design — recording is best-effort.
    }
  }

  /**
   * Public auto-suggest (B3.3). `GET /api/v1/search/suggest?q=<prefix>&scope=
   * business|category|neighborhood|city|all&limit=8` returns a small, ranked
   * list of matches for a typeahead. Results are Redis-cached (60s TTL) keyed by
   * the normalised prefix + scope + cityId + limit. Rate-limited per IP at
   * 120/min (suggest is lighter than full search and bursty with keystrokes).
   */
  @Public()
  @Get('search/suggest')
  @RateLimit({ name: 'search.suggest', limit: 120, windowSec: 60 })
  async runSuggest(@Query(new ZodValidationPipe(suggestQuerySchema)) query: SuggestQuery) {
    return this.suggest.suggest(query);
  }

  /**
   * The logged-in user's recent searches (B3.5), newest first. Authenticated
   * (global JwtAuthGuard — NOT @Public). History is recorded automatically by
   * `GET /search` when a valid access token rides along; this endpoint only
   * reads it. Capped at 20 rows per user on the write side.
   */
  @Get('search/history')
  @RateLimit({ name: 'search.history.read', limit: 60, windowSec: 60 })
  async history(
    @Req() req: AuthenticatedHttpRequest,
    @Query(new ZodValidationPipe(searchHistoryQuerySchema)) query: SearchHistoryQuery,
  ): Promise<SearchHistoryResult> {
    return this.stats.history(this.userId(req), query);
  }

  /** Clear the user's whole history (B3.5). Returns the removed-row count. */
  @Delete('search/history')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'search.history.write', limit: 30, windowSec: 60 })
  async clearHistory(@Req() req: AuthenticatedHttpRequest): Promise<ClearSearchHistoryResult> {
    return this.stats.clear(this.userId(req));
  }

  /** Remove one history entry (B3.5). 404 when the id is unknown or not owned. */
  @Delete('search/history/:id')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'search.history.write', limit: 30, windowSec: 60 })
  async removeHistoryItem(
    @Req() req: AuthenticatedHttpRequest,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ deleted: 1 }> {
    return this.stats.remove(this.userId(req), id);
  }

  /**
   * Public popular ("trending") queries (B3.5) — the global `search_queries`
   * counter, no user data, `hits DESC` with a stable tiebreaker. Optional
   * `cityId` scopes the list to one city (e.g. the city page's chips).
   */
  @Public()
  @Get('search/popular')
  @RateLimit({ name: 'search.popular', limit: 60, windowSec: 60 })
  async popular(
    @Query(new ZodValidationPipe(popularQueriesQuerySchema)) query: PopularQueriesQuery,
  ): Promise<PopularQueriesResult> {
    return this.stats.popular(query);
  }

  /** The authenticated routes are NOT @Public — the global JwtAuthGuard has
   * already set req.user; `?? ''` mirrors the ProfileController helper and
   * keeps the type honest. */
  private userId(req: AuthenticatedHttpRequest): string {
    return req.user?.id ?? '';
  }
}
