import { notFound } from 'next/navigation';
import { defaultThemePacks, type ThemePackId } from '@app/contracts';
import { DevUiClient } from './dev-ui-client';

/**
 * Dev-only UI playground (F1.2). In production this route 404s (the
 * `production` check below). It renders a pack preview matrix: a toolbar to
 * pick any of the three packs and light/dark, and swatches of every token,
 * the type scale, radii and shadows so a human can verify all three packs
 * visually. The `?pack=` and `?mode=` query params override the active pack
 * ONLY on this dev route (client-side, via DevUiClient).
 */

const PACK_IDS: ThemePackId[] = ['modern', 'warm', 'luxe'];

export const dynamic = 'force-dynamic';

export default async function DevUiPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string; mode?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  const sp = await searchParams;
  const packId = (PACK_IDS as readonly string[]).includes(sp.pack ?? '')
    ? (sp.pack as ThemePackId)
    : 'modern';
  const mode = sp.mode === 'dark' ? 'dark' : 'light';

  // Token lists for the matrix.
  const colorKeys = [
    'bg',
    'surface',
    'surfaceAlt',
    'text',
    'muted',
    'border',
    'borderSubtle',
    'primary',
    'onPrimary',
    'accent',
    'success',
    'warning',
    'danger',
    'ring',
    'overlay',
  ];

  return (
    <DevUiClient
      packs={defaultThemePacks.map((p) => ({ id: p.id, name: p.names.fa ?? p.names.en ?? p.id }))}
      initialPack={packId}
      initialMode={mode}
      colorKeys={colorKeys}
    />
  );
}
