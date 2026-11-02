/**
 * Vitest setup (F1.3) — loaded before every test file.
 *
 * Adds the jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`, …) that
 * the component specs rely on, and installs `ResizeObserver`/`matchMedia`
 * shims that Radix UI and the theme hook expect in jsdom.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so the DOM stays isolated.
afterEach(() => {
  cleanup();
});

// jsdom omits these; Radix Avatar + the theme hook read them.
class ResizeObserverShim {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverShim }).ResizeObserver =
  ResizeObserverShim;

if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom has no layout, so Radix avatar image onload never fires naturally; the
// tests that need it trigger it explicitly. Keep this a no-op shim so imports
// don't throw.
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
