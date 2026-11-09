// src/components/map/map-protocol.ts — one-time `pmtiles://` protocol
// registration for MapLibre (I3.1/F3.1). The basemap style's vector source is
// `pmtiles://<tiles-origin>/tiles/iran.pmtiles`; MapLibre delegates every
// fetch for that scheme to the handler registered here, which issues HTTP
// range requests against the archive (nginx serves Accept-Ranges — see
// infra/tiles/README.md).
//
// Registration is module-level + idempotent: Next.js may evaluate the module
// more than once per bundle context (client + HMR), and calling
// `addProtocol('pmtiles', …)` twice replaces the handler — safe, but the
// protocol instance must stay single so its tile cache is shared.
import { Protocol } from 'pmtiles';
import type { AddProtocolAction } from 'maplibre-gl';

let registered = false;

/**
 * Register the pmtiles protocol on a MapLibre-like `addProtocol` host.
 * Returns whether this call performed the registration (false = a previous
 * call already did — useful for tests that reset the maplibre module).
 */
export function registerPmtilesProtocol(
  addProtocol: (name: string, handler: AddProtocolAction) => void,
): boolean {
  if (registered) return false;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile as AddProtocolAction);
  registered = true;
  return true;
}

/** Test-only reset (the real module never un-registers). */
export function resetPmtilesProtocolForTests(): void {
  registered = false;
}
