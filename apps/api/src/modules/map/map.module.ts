import { Module } from '@nestjs/common';
import { MapRepository } from './map.repository.js';
import { MapService } from './map.service.js';
import { MapController } from './map.controller.js';

/**
 * Map module (B3.4). The public map endpoint and its SQL layer, following the
 * SearchModule pattern (B3.2/B3.3): a thin controller over a normalizing
 * service over a parameterised-SQL repository. Deliberately a separate module
 * from SearchModule — the map layer is geo-only (PostGIS bbox + grid
 * clustering, no full-text/trigram) and media-free (points carry no images;
 * popups fetch business detail on demand), so it imports nothing: `DrizzleClient`
 * is @Global and `CacheService` is @Global via `RedisModule`.
 */
@Module({
  controllers: [MapController],
  providers: [MapRepository, MapService],
})
export class MapModule {}
