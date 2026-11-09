import { Controller, Get, Query } from '@nestjs/common';
import { mapQuerySchema, type MapQuery, type MapResult } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// MapService is constructor-injected: Nest reads the type at runtime via
// emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MapService } from './map.service.js';

/**
 * Public map endpoint (B3.4). `GET /api/v1/map/businesses` accepts the map
 * viewport (`bbox=west,south,east,north`), the MapLibre `zoom` and an
 * optional `cityId`, and answers with either grid clusters (zoomed out) or
 * individual business points (zoom ≥ 14) — one shape, switched on `mode`.
 * Only `active`, non-soft-deleted businesses are returned.
 *
 * Rate-limited per IP — the endpoint is anonymous and fires on every map
 * pan/zoom; the Redis cache (60s TTL, bbox quantized to ~111m cells) absorbs
 * the repeat traffic, the rate limit absorbs the distinct-viewport flood.
 * The response is the success envelope `{ mode, items, meta }` per AGENTS.md
 * §6 — note the result is not paginated: clusters cover the whole bbox by
 * construction and points are capped at `MAP_MAX_POINTS` with `truncated`.
 */
@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Public()
  @Get('businesses')
  @RateLimit({ name: 'map.businesses', limit: 120, windowSec: 60 })
  async mapBusinesses(
    @Query(new ZodValidationPipe(mapQuerySchema)) query: MapQuery,
  ): Promise<MapResult> {
    return this.mapService.map(query);
  }
}
