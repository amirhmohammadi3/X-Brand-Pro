// src/lib/map/geojson.ts — pure builders converting the B3.4 map endpoint
// response (`MapResult` from @app/contracts) into the GeoJSON FeatureCollections
// the MapView's MapLibre layers consume (F3.1). Pure + framework-free so the
// shape math is unit-testable without a map instance.
//
// Minimal local GeoJSON types (Point-only) instead of pulling @types/geojson
// into apps/web: MapLibre's `setData` consumes these structurally, and the
// map stack only ever renders point features.
import type { MapResult, MapCluster, MapPoint } from '@app/contracts';

export interface GeoJsonPointFeature<P> {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: P;
}

export interface GeoJsonFeatureCollection<P> {
  type: 'FeatureCollection';
  features: Array<GeoJsonPointFeature<P>>;
}

/** GeoJSON properties of a cluster feature (circle + count label). */
export interface ClusterProps {
  count: number;
}

/** GeoJSON properties of a business-point feature (marker + popup). */
export interface PointProps {
  id: string;
  slug: string;
  name: string;
  primaryCategorySlug: string;
  avgRating: number;
  reviewCount: number;
  isFeatured: boolean;
}

export type MapFeatureCollection = GeoJsonFeatureCollection<ClusterProps | PointProps>;

/** Clusters mode → one point feature per server cluster, `count` property. */
export function toClusterCollection(result: MapResult): GeoJsonFeatureCollection<ClusterProps> {
  const clusters: MapCluster[] = result.mode === 'clusters' ? result.items : [];
  return {
    type: 'FeatureCollection',
    features: clusters.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.location.lng, c.location.lat] },
      properties: { count: c.count },
    })),
  };
}

/** Points mode → one point feature per business, popup properties attached. */
export function toPointCollection(result: MapResult): GeoJsonFeatureCollection<PointProps> {
  const points: MapPoint[] = result.mode === 'points' ? result.items : [];
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.location.lng, p.location.lat] },
      properties: {
        id: p.id,
        slug: p.slug,
        name: p.name,
        primaryCategorySlug: p.primaryCategorySlug,
        avgRating: p.avgRating,
        reviewCount: p.reviewCount,
        isFeatured: p.isFeatured,
      },
    })),
  };
}

/**
 * The viewport the map emits on load and every move end: the B3.4 query
 * string (`bbox=west,south,east,north`) + the integer zoom + the mode the
 * SERVER will answer with (the B3.4 threshold — clients do not guess it).
 * Coordinates are rounded to 5 decimals (~1 m) to keep URLs/keys small.
 */
export interface MapViewport {
  bbox: string;
  zoom: number;
  mode: 'clusters' | 'points';
}

export function viewportFromBounds(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  pointZoomMin: number,
): MapViewport {
  const r = (v: number) => Math.round(v * 100000) / 100000;
  return {
    bbox: `${r(bounds.west)},${r(bounds.south)},${r(bounds.east)},${r(bounds.north)}`,
    zoom: Math.round(zoom),
    mode: Math.round(zoom) >= pointZoomMin ? 'points' : 'clusters',
  };
}
