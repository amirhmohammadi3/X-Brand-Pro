// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ActiveThemeProvider } from '../../src/lib/theme/active-theme-context';
import { defaultThemePacks } from '@app/contracts';

const tokensStub = defaultThemePacks.find((p) => p.id === 'modern')!.tokens;

/**
 * F3.1 MapView — jsdom has no WebGL, so the `maplibre-gl` module is mocked
 * with a recording fake: the suite asserts the WIRING (style URLs per mode,
 * the pmtiles protocol registration, source/layer lifecycle, data → setData,
 * cluster/point visibility toggling, viewport emissions, unmount cleanup).
 * The pure pieces (GeoJSON builders, viewport maths, popup HTML) have their
 * own direct specs below; the real rendering needs a browser (Docker e2e,
 * follow-up).
 */

type Handler = (...args: unknown[]) => void;

class FakeMap {
  static instances: FakeMap[] = [];
  styleArg: unknown;
  options: Record<string, unknown>;
  private handlers = new Map<string, Set<Handler>>();
  sources = new Map<string, unknown>();
  layers = new Map<string, unknown>();
  layoutProps = new Map<string, unknown>();
  controls: string[] = [];
  style = { setStyleCalls: [] as string[] };
  removed = false;
  zoomValue = 12;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    this.styleArg = options.style;
    FakeMap.instances.push(this);
  }
  on(event: string, ...rest: unknown[]): void {
    const handler = rest[rest.length - 1] as Handler;
    const key = rest.length === 2 ? `${event}:${rest[0] as string}` : event;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
  }
  off(event: string, ...rest: unknown[]): void {
    const handler = rest[rest.length - 1] as Handler;
    const key = rest.length === 2 ? `${event}:${rest[0] as string}` : event;
    this.handlers.get(key)?.delete(handler);
  }
  emit(key: string, arg: unknown = {}): void {
    for (const h of this.handlers.get(key) ?? []) h(arg);
  }
  addSource(id: string, spec: unknown): void {
    this.sources.set(id, spec);
  }
  hasSource(id: string): boolean {
    return this.sources.has(id);
  }
  getSource(id: string): { setData: (d: unknown) => void } | undefined {
    if (!this.sources.has(id)) return undefined;
    return { setData: (d: unknown) => this.sources.set(`${id}#data`, d) };
  }
  addLayer(layer: Record<string, unknown>): void {
    this.layers.set(layer.id as string, layer);
  }
  hasLayer(id: string): boolean {
    return this.layers.has(id);
  }
  getLayer(id: string): unknown | undefined {
    return this.layers.get(id);
  }
  setLayoutProperty(id: string, prop: string, value: unknown): void {
    this.layoutProps.set(`${id}:${prop}`, value);
  }
  addControl(control: unknown): void {
    this.controls.push(
      (control as { constructor?: { name?: string } }).constructor?.name ?? 'unknown',
    );
  }
  getBounds(): {
    getWest: () => number;
    getSouth: () => number;
    getEast: () => number;
    getNorth: () => number;
  } {
    return { getWest: () => 51.0, getSouth: () => 35.5, getEast: () => 51.8, getNorth: () => 36.0 };
  }
  getZoom(): number {
    return this.zoomValue;
  }
  getCenter(): { lat: number; lng: number } {
    return { lat: 35.6892, lng: 51.389 };
  }
  flyTo(): void {}
  easeTo(): void {}
  setStyle(url: string): void {
    this.style.setStyleCalls.push(url);
  }
  remove(): void {
    this.removed = true;
  }
  clickOnLayer(layerKey: string, arg: unknown): void {
    for (const h of this.handlers.get(`click:${layerKey}`) ?? []) h(arg);
  }
}

const popupInstances: Array<{ html: string }> = [];

vi.mock('maplibre-gl', () => {
  class Popup {
    html = '';
    setLngLat(): this {
      return this;
    }
    setHTML(html: string): this {
      this.html = html;
      popupInstances.push({ html });
      return this;
    }
    addTo(): this {
      return this;
    }
  }
  return {
    Map: FakeMap,
    Popup,
    NavigationControl: class NavigationControl {},
    GeolocateControl: class GeolocateControl {
      on(): void {}
    },
    addProtocol: vi.fn(),
    AttributionControl: class AttributionControl {},
  };
});

vi.mock('pmtiles', () => ({
  Protocol: class Protocol {
    tile = () => undefined;
  },
}));

const { MapView, popupHtml } = await import('../../src/components/map/map-view');
const { registerPmtilesProtocol, resetPmtilesProtocolForTests } = await import(
  '../../src/components/map/map-protocol'
);
const maplibreModule = (await import('maplibre-gl')) as unknown as {
  addProtocol: ReturnType<typeof vi.fn>;
};
const { toClusterCollection, toPointCollection, viewportFromBounds } = await import(
  '../../src/lib/map/geojson'
);
import type { MapResult } from '@app/contracts';

const messages = {
  map: {
    aria: 'نقشه کسب‌وکارها',
    popup: { rating: 'امتیاز' },
    userLocation: 'موقعیت من',
  },
};

function renderView(props: Partial<React.ComponentProps<typeof MapView>> = {}) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <ActiveThemeProvider
        value={{
          packId: 'modern',
          tokens: tokensStub,
          resolvedMode: (document.documentElement.getAttribute('data-mode') === 'dark'
            ? 'dark'
            : 'light') as 'light' | 'dark',
        }}
      >
        <MapView data={props.data ?? null} {...props} />
      </ActiveThemeProvider>
    </NextIntlClientProvider>,
  );
}

const clustersResult: MapResult = {
  mode: 'clusters',
  items: [
    { location: { lat: 35.7, lng: 51.4 }, count: 7 },
    { location: { lat: 35.75, lng: 51.45 }, count: 30 },
  ],
  meta: { zoom: 10, total: 37, truncated: false },
};

const pointsResult: MapResult = {
  mode: 'points',
  items: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      slug: 'cafe-azadi',
      name: 'کافه آزادی',
      primaryCategorySlug: 'cafe',
      location: { lat: 35.7, lng: 51.4 },
      avgRating: 4.5,
      reviewCount: 12,
      isFeatured: true,
    },
  ],
  meta: { zoom: 16, total: 1, truncated: false },
};

beforeEach(() => {
  FakeMap.instances = [];
  popupInstances.length = 0;
  document.documentElement.setAttribute('data-mode', 'light');
  maplibreModule.addProtocol.mockClear();
  resetPmtilesProtocolForTests();
});

describe('MapView mount + pmtiles protocol (F3.1)', () => {
  it('registers the pmtiles protocol exactly once and constructs the map with the light style', () => {
    const { unmount } = renderView();
    expect(maplibreModule.addProtocol).toHaveBeenCalledTimes(1);
    expect(maplibreModule.addProtocol.mock.calls[0]![0]).toBe('pmtiles');
    expect(FakeMap.instances).toHaveLength(1);
    expect(FakeMap.instances[0]!.styleArg).toContain('/style.json');
    expect(FakeMap.instances[0]!.styleArg).not.toContain('style.dark');
    unmount();
  });

  it('a second component instance does NOT re-register the protocol', () => {
    const first = renderView();
    const second = renderView();
    expect(maplibreModule.addProtocol).toHaveBeenCalledTimes(1);
    expect(FakeMap.instances).toHaveLength(2);
    first.unmount();
    second.unmount();
  });

  it('mount-only props: center + zoom pass through, defaults are Tehran', () => {
    const { unmount } = renderView({ initialCenter: [51.4, 35.7], initialZoom: 10 });
    const map = FakeMap.instances[0]!;
    expect(map.options.center).toEqual([51.4, 35.7]);
    expect(map.options.zoom).toBe(10);
    unmount();
  });

  it('unmount removes the map', () => {
    const { unmount } = renderView();
    const map = FakeMap.instances[0]!;
    unmount();
    expect(map.removed).toBe(true);
  });
});

describe('MapView data wiring (F3.1)', () => {
  it('load: adds two sources + three layers and seeds empty collections', () => {
    const { unmount } = renderView({ data: clustersResult });
    const map = FakeMap.instances[0]!;
    map.emit('load');
    expect(map.sources.has('xbrand-clusters')).toBe(true);
    expect(map.sources.has('xbrand-points')).toBe(true);
    expect(map.layers.has('xbrand-cluster-circle')).toBe(true);
    expect(map.layers.has('xbrand-cluster-count')).toBe(true);
    expect(map.layers.has('xbrand-point-icon')).toBe(true);
    // cluster circle visible, point icon hidden
    expect(map.layoutProps.get('xbrand-cluster-circle:visibility')).toBe('visible');
    expect(map.layoutProps.get('xbrand-point-icon:visibility')).toBe('none');
    // data pushed into the cluster source
    const seeded = map.sources.get('xbrand-clusters#data') as { features: unknown[] };
    expect(seeded.features).toHaveLength(2);
    unmount();
  });

  it('data mode flip → visibility toggles (clusters ↔ points)', () => {
    const { rerender, unmount } = renderView({ data: clustersResult });
    const map = FakeMap.instances[0]!;
    map.emit('load');
    rerender(
      <NextIntlClientProvider locale="fa" messages={messages}>
        <ActiveThemeProvider
          value={{ packId: 'modern', tokens: tokensStub, resolvedMode: 'light' }}
        >
          <MapView data={pointsResult} />
        </ActiveThemeProvider>
      </NextIntlClientProvider>,
    );
    expect(map.layoutProps.get('xbrand-cluster-circle:visibility')).toBe('none');
    expect(map.layoutProps.get('xbrand-point-icon:visibility')).toBe('visible');
    const pointData = map.sources.get('xbrand-points#data') as {
      features: Array<{ properties: { name: string } }>;
    };
    expect(pointData.features[0]?.properties.name).toBe('کافه آزادی');
    unmount();
  });

  it('style.load after setStyle re-applies sources + layers (idempotent)', () => {
    const { unmount } = renderView({ data: clustersResult });
    const map = FakeMap.instances[0]!;
    map.emit('load');
    map.emit('style.load'); // simulate a setStyle swap
    // no duplicates — has() guards held
    expect(map.layers.size).toBe(3);
    const seeded = map.sources.get('xbrand-clusters#data') as { features: unknown[] };
    expect(seeded.features).toHaveLength(2);
    unmount();
  });
});

describe('MapView viewport + interactions (F3.1)', () => {
  it('emits the viewport on load and moveend with the B3.4 bbox string', () => {
    const onViewportChange = vi.fn();
    const { unmount } = renderView({ onViewportChange });
    const map = FakeMap.instances[0]!;
    map.emit('load');
    map.emit('moveend');
    const expected = viewportFromBounds(
      { west: 51.0, south: 35.5, east: 51.8, north: 36.0 },
      12,
      14,
    );
    expect(expected.bbox).toBe('51,35.5,51.8,36');
    expect(expected.mode).toBe('clusters');
    expect(onViewportChange).toHaveBeenCalledTimes(2);
    expect(onViewportChange).toHaveBeenLastCalledWith(expected);
    unmount();
  });

  it('adds the geolocate control', () => {
    const { unmount } = renderView();
    expect(FakeMap.instances[0]!.controls).toContain('GeolocateControl');
    unmount();
  });

  it('clicking a point opens an RTL popup with the business link + rating', () => {
    const { unmount } = renderView({ data: pointsResult });
    const map = FakeMap.instances[0]!;
    map.emit('load');
    map.clickOnLayer('xbrand-point-icon', {
      features: [
        {
          geometry: { coordinates: [51.4, 35.7] },
          properties: {
            id: '33333333-3333-3333-3333-333333333333',
            slug: 'cafe-azadi',
            name: 'کافه آزادی',
            avgRating: 4.5,
            reviewCount: 12,
            isFeatured: true,
          },
        },
      ],
    });
    expect(popupInstances).toHaveLength(1);
    const popup = popupInstances[0]!.html;
    expect(popup).toContain('dir="rtl"');
    // fa is UNPREFIXED (as-needed routing, lib/search/links)
    expect(popup).toContain('href="/business/cafe-azadi"');
    expect(popup).toContain('کافه آزادی');
    expect(popup).toContain('★');
    unmount();
  });

  it('clicking a cluster eases toward it (+1.5 zoom)', () => {
    const { unmount } = renderView({ data: clustersResult });
    const map = FakeMap.instances[0]!;
    map.emit('load');
    const easeSpy = vi.spyOn(map, 'easeTo');
    map.clickOnLayer('xbrand-cluster-circle', {
      features: [{ geometry: { coordinates: [51.4, 35.7] }, properties: { count: 7 } }],
    });
    expect(easeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ center: [51.4, 35.7], zoom: 13.5 }),
    );
    unmount();
  });
});

describe('MapView theme sync (F3.1)', () => {
  it('dark mode attribute → setStyle(style.dark.json); light flips back', async () => {
    const { rerender, unmount } = renderView();
    const map = FakeMap.instances[0]!;
    map.emit('load');
    document.documentElement.setAttribute('data-mode', 'dark');
    rerender(
      <NextIntlClientProvider locale="fa" messages={messages}>
        <ActiveThemeProvider value={{ packId: 'modern', tokens: tokensStub, resolvedMode: 'dark' }}>
          <MapView data={null} />
        </ActiveThemeProvider>
      </NextIntlClientProvider>,
    );
    // the effect fires after rerender — flush it
    await new Promise((r) => setTimeout(r, 0));
    expect(map.style.setStyleCalls).toHaveLength(1);
    expect(map.style.setStyleCalls[0]).toContain('style.dark.json');
    // re-apply after the swap does not duplicate layers
    map.emit('style.load');
    expect(map.layers.size).toBe(3);
    // and back
    document.documentElement.setAttribute('data-mode', 'light');
    rerender(
      <NextIntlClientProvider locale="fa" messages={messages}>
        <ActiveThemeProvider
          value={{ packId: 'modern', tokens: tokensStub, resolvedMode: 'light' }}
        >
          <MapView data={null} />
        </ActiveThemeProvider>
      </NextIntlClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(map.style.setStyleCalls).toHaveLength(2);
    unmount();
  });
});

describe('pure helpers (F3.1)', () => {
  it('toClusterCollection / toPointCollection ignore foreign modes', () => {
    expect(toClusterCollection(pointsResult).features).toEqual([]);
    expect(toPointCollection(clustersResult).features).toEqual([]);
    expect(toClusterCollection(clustersResult).features[0]?.properties).toEqual({ count: 7 });
    expect(toPointCollection(pointsResult).features[0]?.geometry.coordinates).toEqual([51.4, 35.7]);
  });

  it('popupHtml escapes hostile names', () => {
    const html = popupHtml(
      {
        id: 'x',
        slug: 'x',
        name: '<script>alert("x")</script>',
        primaryCategorySlug: 'cafe',
        avgRating: 4,
        reviewCount: 1,
        isFeatured: false,
      },
      'fa',
      'امتیاز',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('map-protocol (F3.1)', () => {
  it('registers once, then reports already-registered', () => {
    const addProtocol = vi.fn();
    expect(registerPmtilesProtocol(addProtocol as never)).toBe(true);
    expect(registerPmtilesProtocol(addProtocol as never)).toBe(false);
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol.mock.calls[0]![0]).toBe('pmtiles');
    expect(typeof addProtocol.mock.calls[0]![1]).toBe('function');
  });
});
