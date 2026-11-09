import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { SearchRepository } from './search.repository.js';
import { SearchService } from './search.service.js';
import { SearchController } from './search.controller.js';

/**
 * Search module (B3.2). The public `GET /api/v1/search` endpoint and its SQL
 * layer. Imports `MediaModule` so the repository can inject `MediaUrlService`
 * for cover/thumb URL resolution; `DrizzleClient` is @Global so no import
 * needed. The repository builds a single parameterised query over the B3.1
 * search infrastructure (tsvector GIN + PostGIS GiST + trigram indexes).
 *
 * Deliberately separate from `BusinessModule`: search is read-only, anonymous
 * and cross-cuts cities/categories/neighborhoods/media — coupling it to the
 * write-heavy business module would pull in its providers for nothing.
 */
@Module({
  imports: [MediaModule],
  controllers: [SearchController],
  providers: [SearchRepository, SearchService],
})
export class SearchModule {}
