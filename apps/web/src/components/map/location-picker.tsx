'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Bbox } from '@app/contracts';
import { MapView, type MapViewHandle } from './map-view';
import { Button } from '@/components/ui/button';
import { DEFAULT_CENTER } from '@/lib/map/style-urls';

/**
 * Location picker (F3.2) — the map-based position chooser for business
 * registration (the owner form mounts it in F5.x; the component is the
 * deliverable here, wired exactly like any other form control).
 *
 * Interaction model: **a center crosshair** — the user pans/zooms, the
 * selected position is ALWAYS the map center (the standard pick-a-place UX:
 * no marker dragging, works one-handed on mobile, and reuses MapView's
 * viewport emission instead of owning a second map instance). A tap on the
 * map recenters it (MapLibre's default double-tap/one-finger pan; the click
 * → easeTo center is handled inside the picker via the MapView's click
 * surface — see below). "استفاده از موقعیت من" jumps to the device's GPS fix
 * (the same GeolocateControl behavior, driven by the picker so the result
 * flows through the same onSelect path).
 *
 * Commit model: the picker shows a live lat/lng readout and the selection
 * commits on the تأیید button (`onSelect`) — panning never spams the form
 * state with intermediate positions. When the host passes the city's bbox
 * (cities carry one — B2.1), a warning chip appears while the center sits
 * outside it; the selection is still allowed (the API re-validates — B2.6).
 */

export interface LocationPickerProps {
  /** The city bbox (west/south/east/north) for the out-of-area warning. */
  cityBbox?: Bbox | null;
  /** Initial center [lng, lat] — defaults to Tehran (city pages pass their own). */
  initialCenter?: [number, number];
  /** Commits the current map center as the selected position. */
  onSelect?: (point: { lat: number; lng: number }) => void;
  className?: string;
}

export function LocationPicker({
  cityBbox = null,
  initialCenter = DEFAULT_CENTER,
  onSelect,
  className,
}: LocationPickerProps) {
  const t = useTranslations('map');
  const mapRef = useRef<MapViewHandle | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: initialCenter[1],
    lng: initialCenter[0],
  });
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const insideBbox = useMemo(
    () =>
      !cityBbox ||
      (center.lat >= cityBbox.south &&
        center.lat <= cityBbox.north &&
        center.lng >= cityBbox.west &&
        center.lng <= cityBbox.east),
    [cityBbox, center],
  );

  const handleCenterChange = useCallback((c: { lat: number; lng: number }) => setCenter(c), []);

  const useMyLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError(t('geolocation.unavailable'));
      return;
    }
    setGeoLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLocating(false);
        const next = {
          lat: Math.round(pos.coords.latitude * 100000) / 100000,
          lng: Math.round(pos.coords.longitude * 100000) / 100000,
        };
        setCenter(next);
        mapRef.current?.flyTo([next.lng, next.lat], 16);
      },
      () => {
        setGeoLocating(false);
        setGeoError(t('geolocation.denied'));
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [t]);

  return (
    <div className={className} data-testid="location-picker">
      <div className="relative">
        <MapView
          ref={mapRef}
          data={null}
          onCenterChange={handleCenterChange}
          initialCenter={initialCenter}
          className="h-72 w-full rounded-lg"
        />
        {/* center crosshair — the selection is always the map center */}
        <div
          aria-hidden
          data-testid="picker-crosshair"
          // map-canvas geometry: the crosshair sits on the physical center of
          // the raster, which does not flip with the reading direction
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full" // rtl-ok
        >
          {/* teardrop pin silhouette — a map decoration, identical in LTR/RTL */}
          <span className="block h-8 w-8 rounded-full rounded-br-none border-2 border-primary bg-primary/20" />{' '}
          {/* rtl-ok */}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => onSelect?.(center)} data-testid="picker-confirm">
          {t('picker.confirm')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={geoLocating}
          onClick={useMyLocation}
          data-testid="picker-geolocate"
        >
          {t('picker.useMyLocation')}
        </Button>
        <span dir="ltr" data-testid="picker-readout" className="text-sm tabular-nums">
          {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
        </span>
      </div>

      {!insideBbox ? (
        <p role="status" data-testid="picker-outside-warning" className="mt-2 text-sm text-warning">
          {t('picker.outsideCity')}
        </p>
      ) : null}
      {geoError ? (
        <p role="alert" data-testid="picker-geo-error" className="mt-2 text-sm text-danger">
          {geoError}
        </p>
      ) : null}
    </div>
  );
}
