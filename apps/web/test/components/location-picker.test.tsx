// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { Bbox } from '@app/contracts';

/**
 * F3.2 LocationPicker — jsdom suite with the maplibre-gl module mocked (the
 * shared FakeMap pattern from map-view.test.tsx): asserts the interaction
 * contract — the crosshair is present, the live readout tracks the map
 * center, تأیید commits the center via onSelect, the out-of-city warning
 * reacts to the bbox, "use my location" flies to the GPS fix (or surfaces a
 * friendly error when geolocation is unavailable/denied).
 */

class FakeMap {
  static instances: FakeMap[] = [];
  styleArg: unknown;
  options: Record<string, unknown>;
  center = { lat: 35.6892, lng: 51.389 };
  flyCalls: Array<{ center: [number, number]; zoom?: number }> = [];
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  removed = false;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    this.center = (options.center as { lat: number; lng: number }) ?? this.center;
    FakeMap.instances.push(this);
  }
  on(event: string, ...rest: unknown[]): void {
    const handler = rest[rest.length - 1] as (...args: unknown[]) => void;
    const key = rest.length === 2 ? `${event}:${rest[0] as string}` : event;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
  }
  off(): void {}
  emit(key: string, arg: unknown = {}): void {
    for (const h of this.handlers.get(key) ?? []) h(arg);
  }
  addSource(): void {}
  getSource(): undefined {
    return undefined;
  }
  addLayer(): void {}
  getLayer(): undefined {
    return undefined;
  }
  setLayoutProperty(): void {}
  addControl(): void {}
  getBounds(): {
    getWest: () => number;
    getSouth: () => number;
    getEast: () => number;
    getNorth: () => number;
  } {
    return { getWest: () => 51.0, getSouth: () => 35.5, getEast: () => 51.8, getNorth: () => 36.0 };
  }
  getZoom(): number {
    return 12;
  }
  getCenter(): { lat: number; lng: number } {
    return this.center;
  }
  flyTo(o: { center: [number, number]; zoom?: number }): void {
    this.flyCalls.push(o);
    this.center = { lat: o.center[1], lng: o.center[0] };
  }
  easeTo(): void {}
  setStyle(): void {}
  remove(): void {
    this.removed = true;
  }
}

vi.mock('maplibre-gl', () => {
  class Popup {
    setLngLat(): this {
      return this;
    }
    setHTML(): this {
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

const { LocationPicker } = await import('../../src/components/map/location-picker');

const messages = {
  map: {
    aria: 'نقشه کسب‌وکارها',
    popup: { rating: 'امتیاز' },
    picker: {
      confirm: 'تأیید موقعیت',
      useMyLocation: 'استفاده از موقعیت من',
      outsideCity: 'خارج از محدودهٔ شهر انتخابی',
    },
    geolocation: {
      unavailable: 'موقعیت‌یابی در دسترس نیست',
      denied: 'دسترسی به موقعیت رد شد',
    },
  },
};

function renderPicker(props: Partial<React.ComponentProps<typeof LocationPicker>> = {}) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <LocationPicker {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  FakeMap.instances = [];
  document.documentElement.setAttribute('data-mode', 'light');
});

const tehranBbox: Bbox = { west: 51.0, south: 35.5, east: 51.8, north: 36.0 };

describe('LocationPicker (F3.2)', () => {
  it('renders the map, crosshair, confirm + geolocate buttons and the initial readout', () => {
    renderPicker();
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
    expect(screen.getByTestId('picker-crosshair')).toBeInTheDocument();
    expect(screen.getByTestId('picker-confirm')).toHaveTextContent('تأیید موقعیت');
    expect(screen.getByTestId('picker-geolocate')).toHaveTextContent('استفاده از موقعیت من');
    expect(screen.getByTestId('picker-readout')).toHaveTextContent('35.68920, 51.38900');
  });

  it('confirm commits the CURRENT map center via onSelect', () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    const map = FakeMap.instances[0]!;
    act(() => {
      map.center = { lat: 35.7123, lng: 51.40456 };
      map.emit('moveend');
    });
    fireEvent.click(screen.getByTestId('picker-confirm'));
    expect(onSelect).toHaveBeenCalledWith({ lat: 35.7123, lng: 51.40456 });
  });

  it('no warning while inside the city bbox; warning appears when the center leaves it', () => {
    const onSelect = vi.fn();
    const { rerender } = renderPicker({ cityBbox: tehranBbox, onSelect });
    expect(screen.queryByTestId('picker-outside-warning')).not.toBeInTheDocument();
    // move the map center far outside Tehran
    const map = FakeMap.instances[0]!;
    act(() => {
      map.center = { lat: 32.0, lng: 52.0 };
      map.emit('moveend');
    });
    expect(screen.getByTestId('picker-outside-warning')).toHaveTextContent('خارج از محدوده');
    // confirm still works (the API re-validates) and reports the far center
    fireEvent.click(screen.getByTestId('picker-confirm'));
    expect(onSelect).toHaveBeenCalledWith({ lat: 32.0, lng: 52.0 });
    // rerender keeps the picker working (same map instance)
    rerender(
      <NextIntlClientProvider locale="fa" messages={messages}>
        <LocationPicker cityBbox={tehranBbox} onSelect={onSelect} />
      </NextIntlClientProvider>,
    );
    act(() => {
      map.center = { lat: 35.7, lng: 51.4 };
      map.emit('moveend');
    });
    expect(screen.queryByTestId('picker-outside-warning')).not.toBeInTheDocument();
  });

  it('no warning when no city bbox is provided', () => {
    const map = FakeMap.instances[0];
    renderPicker();
    expect(map).toBeUndefined(); // map constructed async via effect; safe guard
    expect(screen.queryByTestId('picker-outside-warning')).not.toBeInTheDocument();
  });

  it('use my location: flies to the GPS fix and updates the readout', async () => {
    renderPicker();
    const map = FakeMap.instances[0]!;
    const getCurrentPosition = vi.fn(
      (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: 35.7448, longitude: 51.3753 } }),
    );
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    fireEvent.click(screen.getByTestId('picker-geolocate'));
    expect(getCurrentPosition).toHaveBeenCalled();
    // effects flush
    await new Promise((r) => setTimeout(r, 0));
    expect(map.flyCalls).toHaveLength(1);
    expect(map.flyCalls[0]!.center).toEqual([51.3753, 35.7448]);
    expect(map.flyCalls[0]!.zoom).toBe(16);
    expect(screen.getByTestId('picker-readout')).toHaveTextContent('35.74480, 51.37530');
  });

  it('geolocation denied → friendly error, no fly', async () => {
    renderPicker();
    const getCurrentPosition = vi.fn((_ok: unknown, err: () => void) => err());
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    fireEvent.click(screen.getByTestId('picker-geolocate'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('picker-geo-error')).toHaveTextContent('دسترسی به موقعیت رد شد');
    expect(FakeMap.instances[0]!.flyCalls).toHaveLength(0);
  });

  it('geolocation unavailable → friendly error', () => {
    renderPicker();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    fireEvent.click(screen.getByTestId('picker-geolocate'));
    expect(screen.getByTestId('picker-geo-error')).toHaveTextContent('موقعیت‌یابی در دسترس نیست');
  });

  it('respects an initialCenter prop (city page passes its own center)', () => {
    renderPicker({ initialCenter: [48.3, 33.5] });
    expect(FakeMap.instances[0]!.options.center).toEqual([48.3, 33.5]);
  });
});
