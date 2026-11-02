/**
 * Ambient declaration for jest-axe (F1.3) — the package ships no types.
 * `axe()` returns a promise of the axe results object; we only read
 * `.violations` in the specs.
 */
declare module 'jest-axe' {
  interface AxeViolation {
    id: string;
    impact: string | null;
    description: string;
    help: string;
    helpUrl: string;
    tags: string[];
  }
  interface AxeResults {
    violations: AxeViolation[];
    passes: unknown[];
    incomplete: unknown[];
    inapplicable: unknown[];
  }
  export function axe(
    element: Element | DocumentFragment | string,
    options?: unknown,
  ): Promise<AxeResults>;
  export const configureAxe: (config?: unknown) => typeof axe;
}
