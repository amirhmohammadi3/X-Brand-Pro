'use client';

import { useCallback, useEffect, useState } from 'react';
import { MODE_COOKIE, type ResolvedMode, type ThemeModePref, resolveServerMode } from './mode';

/**
 * Client hook for the light/dark/system mode (F1.2).
 *
 * `setMode` writes the `mode` cookie (1 year, Lax, path `/`) and updates the
 * `<html data-mode>` attribute immediately so the change is visible without a
 * reload. When the preference is `system` it also subscribes to OS changes.
 *
 * The initial `mode`/`resolvedMode` come from the server-rendered attributes
 * (passed in as props) so there is no hydration mismatch and no flash.
 */

export interface UseThemeModeResult {
  mode: ThemeModePref;
  resolvedMode: ResolvedMode;
  setMode: (next: ThemeModePref) => void;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function writeModeCookie(value: ThemeModePref): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${MODE_COOKIE}=${value}; max-age=${ONE_YEAR_SECONDS}; path=/; samesite=lax`;
}

function readHtmlMode(): ResolvedMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';
}

function readHtmlPref(): ThemeModePref {
  if (typeof document === 'undefined') return 'system';
  const raw = document.documentElement.getAttribute('data-mode-pref');
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function useThemeMode(initial: {
  pref: ThemeModePref;
  resolved: ResolvedMode;
}): UseThemeModeResult {
  const [mode, setModeState] = useState<ThemeModePref>(initial.pref);
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(initial.resolved);

  // Keep local state in sync if the server-rendered attributes change (e.g.
  // the inline system script already flipped to dark before hydration).
  useEffect(() => {
    setResolvedMode(readHtmlMode());
    setModeState(readHtmlPref());
  }, []);

  // While in system mode, follow OS changes.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const next: ResolvedMode = mq.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-mode', next);
      setResolvedMode(next);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  const setMode = useCallback((next: ThemeModePref) => {
    setModeState(next);
    writeModeCookie(next);
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.setAttribute('data-mode-pref', next);
    if (next === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolved: ResolvedMode = dark ? 'dark' : 'light';
      el.setAttribute('data-mode', resolved);
      setResolvedMode(resolved);
    } else {
      el.setAttribute('data-mode', next);
      setResolvedMode(next);
    }
  }, []);

  return { mode, resolvedMode, setMode };
}

export { resolveServerMode };
