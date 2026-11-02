'use client';

import { useEffect, useState } from 'react';
import type { ThemePackId } from '@app/contracts';
import { tokensToCss } from '../../../../lib/theme/tokens-to-css';
import { getBundledPack } from '../../../../lib/theme/server';
import { useThemeMode } from '../../../../lib/theme/use-theme-mode';
import { DevUiShowcase } from './showcase';

interface DevUiClientProps {
  packs: Array<{ id: ThemePackId; name: string }>;
  initialPack: ThemePackId;
  initialMode: 'light' | 'dark';
}

/**
 * Client half of /dev/ui (F1.2 + F1.3). The toolbar picks a pack and a mode;
 * the override is honored ONLY on this dev route by rewriting the `<style
 * id="theme-vars">` contents and the `<html data-*>` attributes client-side.
 * The body is the component gallery (DevUiShowcase).
 */
export function DevUiClient({ packs, initialPack, initialMode }: DevUiClientProps) {
  const [packId, setPackId] = useState<ThemePackId>(initialPack);
  const { mode, resolvedMode, setMode } = useThemeMode({
    pref: initialMode,
    resolved: initialMode,
  });

  // Override the active theme on this dev route whenever the pack changes.
  useEffect(() => {
    const pack = getBundledPack(packId);
    const css = tokensToCss(pack.tokens);
    const el = document.getElementById('theme-vars');
    if (el) el.textContent = css;
    const html = document.documentElement;
    html.setAttribute('data-theme', packId);
    html.setAttribute('data-card', pack.tokens.layout.card);
    html.setAttribute('data-header', pack.tokens.layout.header);
    html.setAttribute('data-density', pack.tokens.density);
  }, [packId]);

  // Keep the URL in sync so the state is shareable.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('pack', packId);
    url.searchParams.set('mode', resolvedMode);
    window.history.replaceState({}, '', url.toString());
  }, [packId, resolvedMode]);

  return (
    <main id="main" className="min-h-dvh bg-bg px-6 py-8 text-text">
      <h1 className="mb-2 text-3xl font-bold">/dev/ui — پیش‌نمایش تم و کامپوننت‌ها</h1>
      <p className="mb-6 text-muted">
        این صفحه فقط در توسعه در دسترس است. پک و حالت را از نوار ابزار عوض کنید.
      </p>

      {/* Toolbar */}
      <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4">
        <span className="text-sm font-semibold">پک:</span>
        {packs.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPackId(p.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              p.id === packId
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border-subtle bg-surface-alt text-text'
            }`}
          >
            {p.name}
          </button>
        ))}
        <span className="ms-4 text-sm font-semibold">حالت:</span>
        {(['light', 'dark', 'system'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              m === mode
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border-subtle bg-surface-alt text-text'
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ms-auto text-xs text-muted">resolved: {resolvedMode}</span>
      </div>

      <DevUiShowcase />
    </main>
  );
}
