import type { ColorSet, ThemeTokens } from './tokens.js';

/**
 * WCAG 2.2 relative-luminance contrast (B1.13). The pairs and thresholds
 * mirror docs/DESIGN.md section 5 exactly; when an admin edits a pack the
 * server recomputes every pair and rejects the update when one fails.
 */

/** WCAG relative luminance of an #RRGGBB color (0..1). */
export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Contrast ratio between two #RRGGBB colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

interface ContrastPairSpec {
  /** `foreground/background` for the failure message, e.g. `text/bg`. */
  name: string;
  fg: keyof ColorSet;
  bg: keyof ColorSet;
  min: number;
}

/** docs/DESIGN.md section 5 — the EXACT pair list and thresholds. */
const PAIRS: readonly ContrastPairSpec[] = [
  { name: 'text/bg', fg: 'text', bg: 'bg', min: 4.5 },
  { name: 'text/surface', fg: 'text', bg: 'surface', min: 4.5 },
  { name: 'text/surfaceAlt', fg: 'text', bg: 'surfaceAlt', min: 4.5 },
  { name: 'muted/bg', fg: 'muted', bg: 'bg', min: 4.5 },
  { name: 'muted/surface', fg: 'muted', bg: 'surface', min: 4.5 },
  { name: 'muted/surfaceAlt', fg: 'muted', bg: 'surfaceAlt', min: 4.5 },
  { name: 'onPrimary/primary', fg: 'onPrimary', bg: 'primary', min: 4.5 },
  { name: 'primary/bg', fg: 'primary', bg: 'bg', min: 4.5 },
  { name: 'primary/surface', fg: 'primary', bg: 'surface', min: 4.5 },
  { name: 'accent/surface', fg: 'accent', bg: 'surface', min: 4.5 },
  { name: 'success/surface', fg: 'success', bg: 'surface', min: 4.5 },
  { name: 'warning/surface', fg: 'warning', bg: 'surface', min: 4.5 },
  { name: 'danger/surface', fg: 'danger', bg: 'surface', min: 4.5 },
  { name: 'border/surface', fg: 'border', bg: 'surface', min: 3.0 },
  { name: 'border/bg', fg: 'border', bg: 'bg', min: 3.0 },
  { name: 'ring/bg', fg: 'ring', bg: 'bg', min: 3.0 },
  { name: 'ring/surface', fg: 'ring', bg: 'surface', min: 3.0 },
];

export interface ContrastFailure {
  mode: 'light' | 'dark';
  pair: string;
  ratio: number;
  min: number;
}

/**
 * Validates both modes of a token set against the DESIGN.md pair list.
 * Returns every failing pair with its computed ratio (empty = valid).
 */
export function validatePackContrast(
  tokens: Pick<ThemeTokens, 'light' | 'dark'>,
): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const colors = tokens[mode];
    for (const spec of PAIRS) {
      const ratio = contrastRatio(colors[spec.fg], colors[spec.bg]);
      if (ratio < spec.min) {
        failures.push({
          mode,
          pair: spec.name,
          ratio: Math.round(ratio * 100) / 100,
          min: spec.min,
        });
      }
    }
  }
  return failures;
}
