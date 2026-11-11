'use client';

import { useEffect, useRef } from 'react';
// maplibre-gl v6 ships named exports only (no default export).
import { Map as MLMap, Marker as MLMarker, NavigationControl, addProtocol } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { styleUrl } from '@/lib/map/style-urls';
import { registerPmtilesProtocol } from '@/components/map/map-protocol';

/**
 * Single-point business map (F4.1). The F3.1 `MapView` is built for the
 * viewport-driven cluster/point search surface (B3.4 refetch on move) — wrong
 * fit for one static location. This component places a SINGLE maplibre DOM
 * marker on the SELF-HOSTED tiles stack (I3.1 — `styleUrl` + the pmtiles
 * protocol, no third-party tile host), centered on the business at zoom 15.
 *
 * - Mode is read from the server-rendered `<html data-mode>` attribute at
 *   mount (no hydration mismatch — the attribute is set before paint by the
 *   theme system). A live toggle re-syncs on next load; the search MapView
 *   owns the live `setStyle` path for the interactive surface.
 * - jsdom has no WebGL; the `maplibre-gl` module is mocked in the spec the
 *   same way as `map-view.test.tsx` — the suite asserts the marker is placed
 *   at [lng, lat] and cleaned up on unmount.
 */
export interface BusinessMapProps {
  lng: number;
  lat: number;
  zoom?: number;
  /** Accessible label for the map canvas (localized by the server page). */
  ariaLabel: string;
}

export function BusinessMap({ lng, lat, zoom = 15, ariaLabel }: BusinessMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const mode = document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';
    registerPmtilesProtocol(addProtocol);
    const map = new MLMap({
      container: el,
      style: styleUrl(mode),
      center: [lng, lat],
      zoom,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const marker = new MLMarker().setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [lng, lat, zoom]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className="h-72 w-full rounded-lg border border-border-subtle sm:h-80"
      data-testid="business-map-canvas"
    />
  );
}
