import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { SearchRepository } from './search.repository.js';
import { SearchService } from './search.service.js';
import { SuggestRepository } from './suggest.repository.js';
import { SuggestService } from './suggest.service.js';
import { SearchController } from './search.controller.js';

/**
 * Search module (B3.2 + B3.3). The public search + auto-suggest endpoints and
 * their SQL layer. Imports `MediaModule` so the search repository can inject
 * `MediaUrlService` for cover/thumb URL resolution (the suggest repository does
 * not need it — suggest hits are lean labels with no media). `DrizzleClient` is
 * @Global so no import needed; `CacheService` is @Global via `RedisModule` so
 * `SuggestService` injects it without an import here.
 *
 * Both repositories build parameterised Drizzle queries over the B3.1 search
 * infrastructure (tsvector GIN + PostGIS GiST + trigram indexes). Deliberately
 * separate from `BusinessModule`: search/suggest are read-only, anonymous and
 * cross-cut cities/categories/neighborhoods/media — coupling them to the
 * write-heavy business module would pull in its providers for nothing.
 */
@Module({
  imports: [MediaModule],
  controllers: [SearchController],
  providers: [SearchRepository, SearchService, SuggestRepository, SuggestService],
})
export class SearchModule {}
