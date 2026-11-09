'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
// maplibre-gl v6 ships named exports only (no default export).
import {
  Map as MLMap,
  Popup as MLPopup,
  NavigationControl,
  GeolocateControl,
  addProtocol,
} from 'maplibre-gl';
import type { Map as MLMapType } from 'maplibre-gl';
import { MAP_POINT_ZOOM_MIN, type MapResult } from '@app/contracts';
import { useLocale, useTranslations } from 'next-intl';
import {
  toClusterCollection,
  toPointCollection,
  viewportFromBounds,
  type MapViewport,
  type PointProps,
} from '@/lib/map/geojson';
import { DEFAULT_CENTER, DEFAULT_ZOOM, styleUrl } from '@/lib/map/style-urls';
import { registerPmtilesProtocol } from './map-protocol';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * MapLibre map component (F3.1) — the basemap, cluster/point rendering, the
 * business popup, the user-location control and theme (mode) sync, all on the
 * SELF-HOSTED tiles stack (I3.1 — no third-party tile hosts, AGENTS.md §7).
 *
 * Architecture notes (DECISIONS 2026-11-09 F3.1):
 * - The component is `maplibregl.Map` in a plain div (no wrapper library).
 *   Marker layers are MapLibre LAYERS over a GeoJSON source (not DOM
 *   markers): hundreds of points stay one WebGL draw, and the cluster/
 *   point toggle is a layer-visibility switch — no re-adding sources.
 * - The B3.4 endpoint answers clusters OR points depending on zoom; the
 *   component keeps BOTH layer sets mounted and flips visibility from
 *   `data.mode`, so a zoom across the threshold is one `setData` per source.
 * - Theme sync: `setStyle(styleUrl(mode))` on mode change. setStyle wipes
 *   runtime sources/layers, so `applyData()` re-adds them on every
 *   `style.load` (idempotent by fixed layer ids).
 * - The pmtiles protocol is registered once before the first Map
 *   construction (map-protocol.ts) — the style's vector source is
 *   `pmtiles://<tiles-origin>/tiles/iran.pmtiles`.
 * - RTL/labels: maplibre-gl v6 bundles bidi-js (RTL shaping built-in — no
 *   external RTLTextPlugin URL, which would violate check-no-external), and
 *   the basemap style already picks Vazirmatn glyph stacks per layer.
 * - jsdom has no WebGL; tests mock the `maplibre-gl` module (test/
 *   components/map-view.test.tsx) and assert the wiring — the real render
 *   needs a browser (Playwright e2e on Docker, follow-up).
 */

/** Fixed source/layer ids — applyData() is idempotent against them. */
const SOURCE_CLUSTERS = 'xbrand-clusters';
const SOURCE_POINTS = 'xbrand-points';
const LAYER_CLUSTER_CIRCLE = 'xbrand-cluster-circle';
const LAYER_CLUSTER_COUNT = 'xbrand-cluster-count';
const LAYER_POINT_ICON = 'xbrand-point-icon';

/** Marker/popup palette (modern pack primary — see docs/DESIGN.md §2). */
const MARKER_SIZE = 0.55;

export interface MapViewProps {
  /** The B3.4 map result for the current viewport (clusters or points). */
  data: MapResult | null;
  /** Fires on load and after every move end — the parent refetches with it. */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Fires alongside onViewportChange with the exact map center (F3.2's
   * location picker consumes it — the bbox midpoint would round to ~1 m). */
  onCenterChange?: (center: { lat: number; lng: number }) => void;
  /** [lng, lat]; defaults to Tehran center. */
  initialCenter?: [number, number];
  initialZoom?: number;
  className?: string;
}

export interface MapViewHandle {
  /** Fly (animated) to a position — F3.2's picker drives "use my location". */
  flyTo: (center: [number, number], zoom?: number) => void;
  /** The current exact center. */
  getCenter: () => { lat: number; lng: number };
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapViewInner(
  {
    data,
    onViewportChange,
    onCenterChange,
    initialCenter = DEFAULT_CENTER,
    initialZoom = DEFAULT_ZOOM,
    className,
  },
  ref,
) {
  const t = useTranslations('map');
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMapType | null>(null);
  // Latest props for the load/style handlers (avoid stale closures).
  const dataRef = useRef<MapResult | null>(data);
  const onViewportChangeRef = useRef(onViewportChange);
  const onCenterChangeRef = useRef(onCenterChange);
  dataRef.current = data;
  onViewportChangeRef.current = onViewportChange;
  onCenterChangeRef.current = onCenterChange;

  // ── mount / unmount: construct + destroy the map once ───────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    registerPmtilesProtocol(addProtocol);

    const map = new MLMap({
      container,
      style: styleUrl(readMode()),
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
    });
    mapRef.current = map;
    // The style was constructed for this mode — record it so the mode-sync
    // effect (below) never calls setStyle on mount (only on real flips).
    (map as unknown as { _xbrandMode?: string })._xbrandMode = readMode();

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: true,
    });
    geolocate.on('geolocate', emitViewport);
    map.addControl(geolocate, 'top-right');

    map.on('load', applyData);
    map.on('style.load', applyData); // setStyle wipes runtime sources/layers
    map.on('moveend', emitViewport);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // initialCenter/initialZoom are mount-only props (documented) — the map
    // is constructed once. eslint-plugin-react-hooks is intentionally not in
    // this repo's lint config (rules live in @app/config); the mount-only
    // contract is enforced by the component test suite instead.
  }, []);

  // Imperative surface for host components (F3.2's LocationPicker): flyTo
  // for "use my location", getCenter for the live readout.
  useImperativeHandle(ref, () => ({
    flyTo: (center: [number, number], zoom?: number) => {
      mapRef.current?.flyTo({ center, zoom: zoom ?? mapRef.current.getZoom(), duration: 600 });
    },
    getCenter: () => {
      const c = mapRef.current?.getCenter();
      return { lat: c?.lat ?? initialCenter[1], lng: c?.lng ?? initialCenter[0] };
    },
  }));

  // ── data prop → the two GeoJSON sources (after load) ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const clusters = map.getSource(SOURCE_CLUSTERS) as GeoJsonSourceLike | undefined;
    const points = map.getSource(SOURCE_POINTS) as GeoJsonSourceLike | undefined;
    if (!clusters || !points) return;
    clusters.setData(toClusterCollection(data));
    points.setData(toPointCollection(data));
    toggleLayerVisibility(map, data.mode);
  }, [data]);

  // ── theme (mode) sync → setStyle; style.load re-applies the data ────────
  // The mode is read from the `data-mode` document attribute — the same
  // source the inline system script writes (lib/theme/mode.ts), so the map
  // follows both explicit switches and OS-driven system-mode flips. The
  // mount effect seeds `_xbrandMode`, so this only fires on real flips.
  const currentMode = readMode();
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if ((map as unknown as { _xbrandMode?: string })._xbrandMode === currentMode) return;
    (map as unknown as { _xbrandMode?: string })._xbrandMode = currentMode;
    map.setStyle(styleUrl(currentMode));
  }, [currentMode]);

  function emitViewport(): void {
    const map = mapRef.current;
    const b = map?.getBounds();
    if (!map) return;
    if (onViewportChangeRef.current && b) {
      onViewportChangeRef.current(
        viewportFromBounds(
          { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
          map.getZoom(),
          MAP_POINT_ZOOM_MIN,
        ),
      );
    }
    const center = map.getCenter();
    onCenterChangeRef.current?.({ lat: center.lat, lng: center.lng });
  }

  /** Add (or re-add after setStyle) the two sources + three layers, then
   * push the latest data into them. Idempotent: fixed ids, `has` guards. */
  function applyData(): void {
    const map = mapRef.current;
    if (!map) return;

    if (!map.getSource(SOURCE_CLUSTERS)) {
      map.addSource(SOURCE_CLUSTERS, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getSource(SOURCE_POINTS)) {
      map.addSource(SOURCE_POINTS, { type: 'geojson', data: emptyFC() });
    }

    if (!map.getLayer(LAYER_CLUSTER_CIRCLE)) {
      map.addLayer({
        id: LAYER_CLUSTER_CIRCLE,
        type: 'circle',
        source: SOURCE_CLUSTERS,
        paint: {
          'circle-color': '#4338CA',
          'circle-opacity': 0.85,
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 16, 10, 22, 100, 32],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        },
      });
    }
    if (!map.getLayer(LAYER_CLUSTER_COUNT)) {
      map.addLayer({
        id: LAYER_CLUSTER_COUNT,
        type: 'symbol',
        source: SOURCE_CLUSTERS,
        layout: {
          // Server clusters carry ASCII counts — the basemap's glyphs serve them.
          'text-field': ['get', 'count'],
          'text-font': ['Vazirmatn Bold'],
          'text-size': 13,
        },
        paint: {
          'text-color': '#FFFFFF',
        },
      });
    }
    if (!map.getLayer(LAYER_POINT_ICON)) {
      map.addLayer({
        id: LAYER_POINT_ICON,
        type: 'symbol',
        source: SOURCE_POINTS,
        layout: {
          'icon-image': 'marker',
          'icon-size': MARKER_SIZE,
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
        },
      });
    }

    // Clicks: point popup + cluster zoom-in. MapLibre dedupes identical
    // (event, layer) registrations? It does NOT — remove first for idempotency
    // (applyData runs again after each setStyle).
    map.off('click', LAYER_POINT_ICON, openPointPopup);
    map.off('click', LAYER_CLUSTER_CIRCLE, zoomToCluster);
    map.on('click', LAYER_POINT_ICON, openPointPopup);
    map.on('click', LAYER_CLUSTER_CIRCLE, zoomToCluster);

    const d = dataRef.current;
    if (d) {
      (map.getSource(SOURCE_CLUSTERS) as GeoJsonSourceLike | undefined)?.setData(
        toClusterCollection(d),
      );
      (map.getSource(SOURCE_POINTS) as GeoJsonSourceLike | undefined)?.setData(
        toPointCollection(d),
      );
      toggleLayerVisibility(map, d.mode);
    }
    emitViewport();
  }

  function openPointPopup(e: MapMouseEvent): void {
    const map = mapRef.current;
    const feature = e.features?.[0];
    if (!map || !feature) return;
    const props = feature.properties as PointProps | undefined;
    if (!props) return;
    const coordinates = (feature.geometry as { coordinates: [number, number] }).coordinates;
    new MLPopup({ offset: 18, closeButton: true })
      .setLngLat(coordinates)
      .setHTML(popupHtml(props, locale, t('popup.rating')))
      .addTo(map);
  }

  function zoomToCluster(e: MapMouseEvent): void {
    const map = mapRef.current;
    const feature = e.features?.[0];
    if (!map || !feature) return;
    const coordinates = (feature.geometry as { coordinates: [number, number] }).coordinates;
    // Server clusters have no expansion zoom — fly to the cluster center one
    // step +1.5 zooms; crossing the point threshold swaps the data mode and
    // the parent refetches (moveend fires).
    map.easeTo({ center: coordinates, zoom: Math.round(map.getZoom()) + 1.5, duration: 450 });
  }

  return (
    <div
      ref={containerRef}
      className={className}
      role="application"
      aria-label={t('aria')}
      data-testid="map-view"
    />
  );
});

// ── local helpers (kept module-level for testability) ──────────────────────

interface GeoJsonSourceLike {
  setData: (data: unknown) => void;
}

interface MapMouseEvent {
  features?: Array<{
    geometry: { coordinates: [number, number] };
    properties?: Record<string, unknown>;
  }>;
}

function emptyFC(): { type: 'FeatureCollection'; features: unknown[] } {
  return { type: 'FeatureCollection', features: [] };
}

function toggleLayerVisibility(map: MLMapType, mode: 'clusters' | 'points'): void {
  map.setLayoutProperty(
    LAYER_CLUSTER_CIRCLE,
    'visibility',
    mode === 'clusters' ? 'visible' : 'none',
  );
  map.setLayoutProperty(
    LAYER_CLUSTER_COUNT,
    'visibility',
    mode === 'clusters' ? 'visible' : 'none',
  );
  map.setLayoutProperty(LAYER_POINT_ICON, 'visibility', mode === 'points' ? 'visible' : 'none');
}

/** Popup markup: RTL-aware (dir from the active locale), lean — the detail
 * page link is wired by F3.4 via the slug. Kept as a pure function for tests. */
export function popupHtml(props: PointProps, locale: string, ratingLabel: string): string {
  const dir = locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr';
  const rating = typeof props.avgRating === 'number' ? props.avgRating.toFixed(1) : null;
  const reviews = typeof props.reviewCount === 'number' ? props.reviewCount : 0;
  const featured = props.isFeatured ? `<span class="xbrand-map-popup-featured">★</span>` : '';
  return `<div dir="${dir}" class="xbrand-map-popup">
    <a href="/${locale}/business/${props.slug}" class="xbrand-map-popup-link">${escapeHtml(props.name)}${featured}</a>
    ${rating ? `<span class="xbrand-map-popup-rating">${rating} · ${ratingLabel} (${reviews})</span>` : ''}
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The resolved mode from the document attribute — the same source the
 * inline system script writes (lib/theme/mode.ts), so the map follows both
 * explicit and OS-driven switches without extra state plumbing. */
function readMode(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';
}
