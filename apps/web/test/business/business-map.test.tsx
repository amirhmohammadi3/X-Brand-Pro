// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * F4.1 BusinessMap — jsdom has no WebGL, so `maplibre-gl` is mocked with a
 * recording fake (same approach as map-view.test.tsx). The suite asserts the
 * WIRING: the map is constructed centered on [lng, lat] at zoom 15 on the
 * self-hosted style, a single marker is placed at [lng, lat], and both are
 * cleaned up on unmount. The real render needs a browser (Docker e2e).
 */

class FakeMap {
  static instances: FakeMap[] = [];
  options: Record<string, unknown>;
  controls: unknown[] = [];
  removed = false;
  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeMap.instances.push(this);
  }
  addControl(control: unknown): void {
    this.controls.push(control);
  }
  remove(): void {
    this.removed = true;
  }
}

class FakeMarker {
  static instances: FakeMarker[] = [];
  lngLat: unknown = null;
  addedTo: unknown = null;
  removed = false;
  constructor() {
    FakeMarker.instances.push(this);
  }
  setLngLat(ll: unknown): this {
    this.lngLat = ll;
    return this;
  }
  addTo(map: unknown): this {
    this.addedTo = map;
    return this;
  }
  remove(): void {
    this.removed = true;
  }
}

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class NavigationControl {},
  addProtocol: vi.fn(),
}));

vi.mock('../../src/lib/map/style-urls', () => ({
  styleUrl: (mode: string) => `https://tiles.test/style.${mode}.json`,
  DEFAULT_CENTER: [51.389, 35.6892] as [number, number],
  DEFAULT_ZOOM: 12,
}));

vi.mock('../../src/components/map/map-protocol', () => ({
  registerPmtilesProtocol: vi.fn(),
}));

const { BusinessMap } = await import('../../src/components/business/business-map');

describe('BusinessMap', () => {
  beforeEach(() => {
    FakeMap.instances = [];
    FakeMarker.instances = [];
  });

  it('constructs the map centered on [lng, lat] at zoom 15 on the self-hosted style', () => {
    render(<BusinessMap lng={51.389} lat={35.6892} ariaLabel="نقشه" />);
    expect(FakeMap.instances).toHaveLength(1);
    const map = FakeMap.instances[0]!;
    expect(map.options.center).toEqual([51.389, 35.6892]);
    expect(map.options.zoom).toBe(15);
    expect(map.options.style).toBe('https://tiles.test/style.light.json');
    expect(map.controls.length).toBeGreaterThan(0); // NavigationControl added
  });

  it('places a single marker at [lng, lat] on the map', () => {
    render(<BusinessMap lng={51.389} lat={35.6892} ariaLabel="map" />);
    expect(FakeMarker.instances).toHaveLength(1);
    const marker = FakeMarker.instances[0]!;
    expect(marker.lngLat).toEqual([51.389, 35.6892]);
    expect(marker.addedTo).toBe(FakeMap.instances[0]!);
  });

  it('removes the marker and the map on unmount', () => {
    const { unmount } = render(<BusinessMap lng={51} lat={35} ariaLabel="m" />);
    const marker = FakeMarker.instances[0]!;
    const map = FakeMap.instances[0]!;
    unmount();
    expect(marker.removed).toBe(true);
    expect(map.removed).toBe(true);
  });

  it('reads the dark style when <html data-mode="dark">', () => {
    document.documentElement.setAttribute('data-mode', 'dark');
    try {
      render(<BusinessMap lng={51} lat={35} ariaLabel="m" />);
      expect(FakeMap.instances[0]!.options.style).toBe('https://tiles.test/style.dark.json');
    } finally {
      document.documentElement.removeAttribute('data-mode');
      cleanup();
    }
  });
});
