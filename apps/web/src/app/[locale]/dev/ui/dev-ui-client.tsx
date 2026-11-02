'use client';

import { useEffect, useState } from 'react';
import type { ThemePackId } from '@app/contracts';
import { tokensToCss } from '../../../../lib/theme/tokens-to-css';
import { getBundledPack } from '../../../../lib/theme/server';
import { useThemeMode } from '../../../../lib/theme/use-theme-mode';

interface DevUiClientProps {
  packs: Array<{ id: ThemePackId; name: string }>;
  initialPack: ThemePackId;
  initialMode: 'light' | 'dark';
  colorKeys: string[];
}

/**
 * Client half of /dev/ui (F1.2). The toolbar picks a pack and a mode; the
 * override is honored ONLY on this dev route by rewriting the `<style
 * id="theme-vars">` contents and the `<html data-*>` attributes client-side.
 * Leaving the route restores the server-rendered active theme on next
 * navigation.
 */
export function DevUiClient({ packs, initialPack, initialMode, colorKeys }: DevUiClientProps) {
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

  const activeTokens = getBundledPack(packId).tokens;
  const modeColors = resolvedMode === 'dark' ? activeTokens.dark : activeTokens.light;

  return (
    <main id="main" className="min-h-dvh bg-bg px-6 py-8 text-text">
      <h1 className="mb-2 text-3xl font-bold">/dev/ui — پیش‌نمایش تم</h1>
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

      {/* Color swatches */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">رنگ‌ها ({resolvedMode})</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {colorKeys.map((key) => {
            const value = (modeColors as Record<string, string>)[key];
            return (
              <div
                key={key}
                className="overflow-hidden rounded-md border border-border-subtle bg-surface"
              >
                <div className="h-16 w-full" style={{ background: value }} aria-hidden />
                <div className="p-2">
                  <div className="text-xs font-semibold">{key}</div>
                  <div className="font-mono text-[10px] text-muted">{value}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Type scale */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">مقیاس تایپوگرافی</h2>
        <div className="space-y-1 rounded-md border border-border-subtle bg-surface p-4">
          <p className="text-xs">xs 12px — متن کمکی</p>
          <p className="text-sm">sm 14px — متن ثانویه</p>
          <p className="text-base">base 16px — متن اصلی بدنه</p>
          <p className="text-lg">lg 18px — زیرعنوان</p>
          <p className="text-xl">xl 20px — عنوان بخش</p>
          <p className="text-2xl">2xl 24px — عنوان کارت</p>
          <p className="text-3xl">3xl 30px — عنوان صفحه</p>
          <p className="text-4xl">4xl 36px — عنوان اصلی</p>
          <p className="text-5xl">5xl 48px — قهرمان (hero)</p>
        </div>
      </section>

      {/* Radii */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">شعاع‌ها</h2>
        <div className="flex flex-wrap gap-4 rounded-md border border-border-subtle bg-surface p-4">
          {(['sm', 'md', 'lg', 'full'] as const).map((r) => (
            <div key={r} className="text-center">
              <div
                className="mx-auto mb-1 h-16 w-16 bg-primary"
                style={{
                  borderRadius: r === 'full' ? '9999px' : `${activeTokens.radius[r]}px`,
                }}
                aria-hidden
              />
              <div className="text-xs text-muted">
                {r}: {activeTokens.radius[r]}px
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Shadows */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">سایه‌ها ({resolvedMode})</h2>
        <div className="flex flex-wrap gap-6 rounded-md border border-border-subtle bg-surface p-6">
          {(['sm', 'md', 'lg'] as const).map((s) => (
            <div key={s} className="text-center">
              <div
                className="mx-auto mb-2 h-16 w-16 rounded-md bg-surface"
                style={{
                  boxShadow:
                    resolvedMode === 'dark'
                      ? activeTokens.shadow.dark[s]
                      : activeTokens.shadow.light[s],
                }}
                aria-hidden
              />
              <div className="text-xs text-muted">{s}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
