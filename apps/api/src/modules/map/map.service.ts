import { Injectable } from '@nestjs/common';
import type { MapCluster, MapPoint, MapQuery, MapResult, NormalizedMapQuery } from '@app/contracts';
import { MAP_MAX_POINTS, MAP_POINT_ZOOM_MIN } from '@app/contracts';
// CacheService is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
// MapRepository is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MapRepository } from './map.repository.js';

/** Cache TTL for map results. Map pan/zoom traffic is bursty and the same
 * viewport gets revisited constantly (list↔map sync re-fires the same bbox);
 * a 60s staleness window is acceptable (a newly-activated business appears
 * within a minute). Matches the suggest/categories cache TTLs. */
const MAP_CACHE_TTL_SEC = 60;

/** Quantization granularity for the cache key: 3 decimals ≈ 111 m on the
 * ground. Sub-decimal bbox jitter from pixel-level panning maps to the same
 * key, while a genuinely new viewport (≥ ~111 m shift of any corner) misses. */
const CACHE_COORD_DECIMALS = 3;

/** What the cache stores: the items plus the bbox total (so a cache hit can
 * rebuild the full response — including `meta.total`/`truncated` — without
 * re-querying). */
interface MapPayload {
  total: number;
  items: MapCluster[] | MapPoint[];
}

/**
 * Map service (B3.4). Normalizes the validated `MapQuery` into a
 * `NormalizedMapQuery` (mode resolved from the zoom, grid cell computed,
 * points cap fixed), then serves the result from Redis via
 * `CacheService.wrap` (read-through; degrades to a miss on Redis failure).
 *
 * Mode resolution: `zoom >= MAP_POINT_ZOOM_MIN` (14) → individual points
 * (capped at `MAP_MAX_POINTS`); below → grid clusters with
 * `cellDeg = 90 / 2^zoom` (≈ a 64px grid cell at 256px Web-Mercator tiles —
 * the cluster size shrinks in lockstep with the map's pixel scale).
 */
@Injectable()
export class MapService {
  constructor(
    private readonly repo: MapRepository,
    private readonly cache: CacheService,
  ) {}

  async map(query: MapQuery): Promise<MapResult> {
    const normalized = this.normalize(query);
    const payload = await this.cache.wrap<MapPayload>(
      this.cacheKey(normalized),
      MAP_CACHE_TTL_SEC,
      async () => this.fetch(normalized),
    );
    return this.toResult(normalized, payload.items, payload.total);
  }

  /** Pure mapping — extracted so it is unit-testable without a DB/Redis. */
  normalize(query: MapQuery): NormalizedMapQuery {
    return {
      bbox: query.bbox,
      zoom: query.zoom,
      mode: query.zoom >= MAP_POINT_ZOOM_MIN ? 'points' : 'clusters',
      cellDeg: this.cellDegForZoom(query.zoom),
      cityId: query.cityId,
      pointLimit: MAP_MAX_POINTS,
    };
  }

  /** Grid cell size in degrees for a Web-Mercator zoom: at zoom z the world
   * (360°) spans `256 * 2^z` pixels, so a ~64px cell covers
   * `360 / (256 * 2^z) * 64 = 90 / 2^z` degrees of longitude at the equator.
   * Clusters only run below `MAP_POINT_ZOOM_MIN`, where this stays ≥ 0.011°
   * (≈1.2 km) — coarse enough to cluster, fine enough to be meaningful. */
  cellDegForZoom(zoom: number): number {
    return 90 / 2 ** zoom;
  }

  /** Pure cache-key builder — extracted for unit testing. Every dimension
   * that changes the result set is in the key; bbox corners are quantized to
   * `CACHE_COORD_DECIMALS` decimals so pixel-level panning jitter hits the
   * same entry instead of flooding Redis with near-identical keys. */
  cacheKey(q: NormalizedMapQuery): string {
    const [w, s, e, n] = [q.bbox.west, q.bbox.south, q.bbox.east, q.bbox.north].map((c) =>
      this.quantize(c),
    );
    return `map:v1:${q.zoom}:${q.cityId ?? 'all'}:${w}:${s}:${e}:${n}`;
  }

  private quantize(v: number): string {
    return (Math.round(v * 10 ** CACHE_COORD_DECIMALS) / 10 ** CACHE_COORD_DECIMALS).toFixed(
      CACHE_COORD_DECIMALS,
    );
  }

  /** One fetch = count + (clusters | points). The count runs in both modes so
   * `meta.total` is always meaningful (the UI can show "N businesses here"
   * and the points mode flags truncation against it). */
  private async fetch(q: NormalizedMapQuery): Promise<MapPayload> {
    const total = await this.repo.countInBbox(q.bbox, q.cityId);
    if (q.mode === 'points') {
      return { total, items: await this.repo.findPoints(q) };
    }
    return { total, items: await this.repo.findClusters(q) };
  }

  /** Pure shape builder — attaches the meta. Points mode is truncated when
   * the repository returned fewer items than the bbox total (the cap clipped
   * it); clusters mode never truncates (every member business lives inside
   * exactly one cluster). */
  private toResult(
    q: NormalizedMapQuery,
    items: MapCluster[] | MapPoint[],
    total: number,
  ): MapResult {
    const meta = {
      zoom: q.zoom,
      total,
      truncated: q.mode === 'points' && items.length < total,
    };
    if (q.mode === 'points') {
      return { mode: 'points', items: items as MapPoint[], meta };
    }
    return { mode: 'clusters', items: items as MapCluster[], meta };
  }
}
