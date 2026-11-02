'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ThemePackId, ThemeTokens } from '@app/contracts';
import type { ResolvedMode } from './mode';

/**
 * Server-rendered context for the active pack's id and layout attributes
 * (F1.2). Components that need the pack id at runtime (e.g. the map style in
 * F3.1) read it from here — NO extra client request, the value is injected
 * by the root layout alongside the `<style id="theme-vars">` block.
 */

export interface ActiveThemeContextValue {
  packId: ThemePackId;
  tokens: ThemeTokens;
  resolvedMode: ResolvedMode;
}

const ActiveThemeContext = createContext<ActiveThemeContextValue | null>(null);

export function ActiveThemeProvider({
  value,
  children,
}: {
  value: ActiveThemeContextValue;
  children: ReactNode;
}) {
  return <ActiveThemeContext.Provider value={value}>{children}</ActiveThemeContext.Provider>;
}

export function useActiveTheme(): ActiveThemeContextValue {
  const ctx = useContext(ActiveThemeContext);
  if (!ctx) {
    throw new Error('useActiveTheme must be used inside <ActiveThemeProvider>');
  }
  return ctx;
}
