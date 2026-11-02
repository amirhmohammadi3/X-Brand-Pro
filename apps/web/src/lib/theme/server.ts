import { z } from 'zod';
import {
  activeThemeSchema,
  defaultThemePacks,
  type ActiveTheme,
  type ThemePack,
  type ThemePackId,
  type ThemeTokens,
} from '@app/contracts';
import { env } from '../env';

/**
 * Server-side active-theme loader (F1.2).
 *
 * `getActiveTheme()` fetches `GET /theme` (B1.13) with a 60 s revalidate window
 * so an admin pack switch propagates to every visitor within a minute. When
 * the API is unreachable it falls back to the bundled `defaultThemePacks`
 * (modern) — the site must keep rendering with NO external dependency
 * (AGENTS.md section 2). ETag/304 is handled by the platform fetch cache.
 *
 * The result is the FULL `ThemeTokens` for the active pack, plus the layout
 * attributes the root layout sets on `<html>` (`data-theme`, `data-card`,
 * `data-header`, `data-density`). Mode (`data-mode`) is resolved separately
 * from the `mode` cookie in `resolveThemeMode`.
 */

const FETCH_TIMEOUT_MS = 3_000;

/** Bundled fallback pack (modern) — used when the API is down. */
export const FALLBACK_PACK: ThemePack =
  defaultThemePacks[0] ??
  ((): never => {
    throw new Error('defaultThemePacks is empty — packs.ts is corrupt');
  })();

function joinApi(path: string): string {
  const base = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface ResolvedTheme {
  packId: ThemePackId;
  packName: string;
  tokens: ThemeTokens;
  /** Layout attributes for `<html>` (card / header / density). */
  layout: ThemeTokens['layout'];
  density: ThemeTokens['density'];
  /** Cache-busting version from the API (or a build constant in fallback). */
  version: string;
  /** True when the value came from the bundled fallback, not the API. */
  fallback: boolean;
}

let cache: { value: ResolvedTheme; fetchedAt: number } | null = null;
let failedAt = 0;
const CACHE_TTL_MS = 60_000;
const FAILURE_TTL_MS = 5_000;

/** Test/infra hook — reset the module cache so tests start clean. */
export function clearActiveThemeCache(): void {
  cache = null;
  failedAt = 0;
}

function fromFallback(): ResolvedTheme {
  const pack = FALLBACK_PACK;
  return {
    packId: pack.id,
    packName: pack.names.fa ?? pack.names.en ?? pack.id,
    tokens: pack.tokens,
    layout: pack.tokens.layout,
    density: pack.tokens.density,
    version: `fallback-${pack.version}`,
    fallback: true,
  };
}

function fromApi(active: ActiveTheme): ResolvedTheme {
  const pack = active.pack;
  return {
    packId: pack.id,
    packName: pack.names.fa ?? pack.names.en ?? pack.id,
    tokens: pack.tokens,
    layout: pack.tokens.layout,
    density: pack.tokens.density,
    version: active.version,
    fallback: false,
  };
}

/**
 * Active theme, cached 60 s in memory (and in Next's RSC Data Cache via the
 * `next.revalidate` option). Never throws: returns the bundled fallback
 * (`modern`) when the API is unreachable.
 */
export async function getActiveTheme(): Promise<ResolvedTheme> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.value;
  if (now - failedAt < FAILURE_TTL_MS) return fromFallback();
  try {
    const response = await fetch(joinApi('/theme'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 60, tags: ['theme:active'] },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const envelope = z.object({ ok: z.literal(true), data: activeThemeSchema }).safeParse(raw);
    if (!envelope.success) throw new Error('invalid active-theme envelope');
    const resolved = fromApi(envelope.data.data);
    cache = { value: resolved, fetchedAt: now };
    return resolved;
  } catch {
    failedAt = now;
    return fromFallback();
  }
}

/** A specific pack by id from the bundled defaults (used by /dev/ui previews). */
export function getBundledPack(id: ThemePackId): ThemePack {
  const pack = defaultThemePacks.find((p) => p.id === id);
  if (!pack) throw new Error(`unknown pack id: ${id}`);
  return pack;
}
