import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { SearchRepository } from './search.repository.js';
import { SearchService } from './search.service.js';
import { SearchStatsRepository } from './search-stats.repository.js';
import { SearchStatsService } from './search-stats.service.js';
import { SuggestRepository } from './suggest.repository.js';
import { SuggestService } from './suggest.service.js';
import { SearchController } from './search.controller.js';

/**
 * Search module (B3.2 + B3.3 + B3.5). The public search + auto-suggest +
 * popular endpoints, the authenticated history endpoints, and their SQL
 * layers. Imports `MediaModule` so the search repository can inject
 * `MediaUrlService` for cover/thumb URL resolution (suggest/stats hits are
 * lean — no media). Imports `AuthModule` for its exported `TokenService`:
 * recording search history (B3.5) needs the OPTIONAL user on the public
 * search route, and the global `JwtAuthGuard` skips @Public routes, so the
 * controller verifies the (possibly absent) access token itself — JWT only,
 * no session/status round trips (DECISIONS B3.5). `DrizzleClient` is @Global;
 * `CacheService` is @Global via `RedisModule` so `SuggestService` injects it
 * without an import here.
 *
 * All repositories build parameterised Drizzle queries over the B3.1 search
 * infrastructure (tsvector GIN + PostGIS GiST + trigram indexes) and the B3.5
 * stats tables. Deliberately separate from `BusinessModule`: search is
 * read-only-ish, anonymous-friendly and cross-cuts cities/categories/
 * neighborhoods/media — coupling it to the write-heavy business module would
 * pull in its providers for nothing.
 */
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [SearchController],
  providers: [
    SearchRepository,
    SearchService,
    SuggestRepository,
    SuggestService,
    SearchStatsRepository,
    SearchStatsService,
  ],
})
export class SearchModule {}
