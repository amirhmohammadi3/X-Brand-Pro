import { notFound } from 'next/navigation';
import { defaultThemePacks, type ThemePackId } from '@app/contracts';
import { DevUiClient } from './dev-ui-client';

/**
 * Dev-only UI playground (F1.2 + F1.3). In production this route 404s (the
 * `production` check below). The toolbar picks any of the three packs and
 * light/dark/system; the body is the component gallery (showcase.tsx). The
 * `?pack=` and `?mode=` query params override the active pack ONLY on this
 * dev route (client-side, via DevUiClient).
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

  return (
    <DevUiClient
      packs={defaultThemePacks.map((p) => ({ id: p.id, name: p.names.fa ?? p.names.en ?? p.id }))}
      initialPack={packId}
      initialMode={mode}
    />
  );
}
