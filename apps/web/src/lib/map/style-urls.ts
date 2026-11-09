// src/lib/map/style-urls.ts — the self-hosted basemap style URLs (I3.1/F3.1).
// The tiles origin comes from NEXT_PUBLIC_TILES_URL (validated in lib/env);
// the style files carry RELATIVE glyph/sprite URLs so they work on any
// deployment origin, and the vector source inside them is baked at generate
// time from the same origin (infra/tiles/README.md §3).
import { env } from '../env';
import type { ResolvedMode } from '../theme/mode';

export function styleUrl(mode: ResolvedMode): string {
  const base = env.NEXT_PUBLIC_TILES_URL.replace(/\/+$/, '');
  return mode === 'dark' ? `${base}/style.dark.json` : `${base}/style.json`;
}

/** Default viewport: Tehran center (the B2.10 seed's default city). */
export const DEFAULT_CENTER: [number, number] = [51.389, 35.6892]; // [lng, lat]
export const DEFAULT_ZOOM = 12;
