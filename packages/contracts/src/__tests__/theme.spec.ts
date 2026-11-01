import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  defaultThemePacks,
  relativeLuminance,
  validatePackContrast,
} from '../theme/index.js';
import type { ThemeTokens } from '../theme/index.js';

describe('contrast math (B1.13, WCAG 2.2)', () => {
  it('relativeLuminance is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('known ratios: black on white is 21.00, #767676 on white is 4.54', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('ratio is symmetric and bounded', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(contrastRatio('#000000', '#FFFFFF'));
    expect(contrastRatio('#0B1020', '#0B1020')).toBeCloseTo(1, 5);
  });
});

// docs/DESIGN.md section 5 — the verified table (light, dark per pack).
const DESIGN_TABLE: Record<'modern' | 'warm' | 'luxe', Record<string, [number, number]>> = {
  modern: {
    'text/bg': [16.68, 16.03],
    'text/surface': [17.85, 14.47],
    'text/surfaceAlt': [15.65, 12.95],
    'muted/bg': [7.08, 8.75],
    'muted/surface': [7.58, 7.89],
    'muted/surfaceAlt': [6.64, 7.07],
    'onPrimary/primary': [7.9, 8.17],
    'primary/bg': [7.38, 8.17],
    'primary/surface': [7.9, 7.37],
    'accent/surface': [5.36, 11.55],
    'success/surface': [7.13, 9.8],
    'warning/surface': [7.09, 10.23],
    'danger/surface': [6.47, 9.0],
    'border/surface': [3.62, 3.75],
    'border/bg': [3.38, 4.16],
    'ring/bg': [7.38, 8.17],
    'ring/surface': [7.9, 7.37],
  },
  warm: {
    'text/bg': [15.6, 15.72],
    'text/surface': [16.56, 14.39],
    'text/surfaceAlt': [14.69, 12.78],
    'muted/bg': [7.43, 9.52],
    'muted/surface': [7.89, 8.72],
    'muted/surfaceAlt': [7.0, 7.74],
    'onPrimary/primary': [5.72, 8.02],
    'primary/bg': [5.38, 8.02],
    'primary/surface': [5.72, 7.34],
    'accent/surface': [5.47, 11.23],
    'success/surface': [7.13, 9.53],
    'warning/surface': [7.09, 11.52],
    'danger/surface': [6.47, 8.75],
    'border/surface': [3.9, 3.61],
    'border/bg': [3.68, 3.95],
    'ring/bg': [5.38, 8.02],
    'ring/surface': [5.72, 7.34],
  },
  luxe: {
    'text/bg': [16.29, 16.82],
    'text/surface': [17.4, 15.17],
    'text/surfaceAlt': [14.92, 13.53],
    'muted/bg': [7.4, 9.47],
    'muted/surface': [7.91, 8.54],
    'muted/surfaceAlt': [6.78, 7.62],
    'onPrimary/primary': [6.24, 9.18],
    'primary/bg': [5.84, 9.18],
    'primary/surface': [6.24, 8.28],
    'accent/surface': [14.68, 14.06],
    'success/surface': [7.13, 9.99],
    'warning/surface': [7.09, 10.43],
    'danger/surface': [6.47, 9.17],
    'border/surface': [3.78, 3.94],
    'border/bg': [3.54, 4.37],
    'ring/bg': [5.84, 9.18],
    'ring/surface': [6.24, 8.28],
  },
};

function ratioOf(tokens: ThemeTokens, mode: 'light' | 'dark', pair: string): number {
  const [fg, bg] = pair.split('/') as [keyof ThemeTokens['light'], keyof ThemeTokens['light']];
  return contrastRatio(tokens[mode][fg], tokens[mode][bg]);
}

describe('seeded theme packs (B1.13)', () => {
  for (const pack of defaultThemePacks) {
    it(`${pack.id}: passes every contrast threshold from DESIGN.md section 5`, () => {
      expect(validatePackContrast(pack.tokens)).toEqual([]);
    });

    it(`${pack.id}: computed ratios match the DESIGN.md table within 0.01`, () => {
      const table = DESIGN_TABLE[pack.id];
      for (const [pair, [light, dark]] of Object.entries(table)) {
        // toBeCloseTo(x, 2) ⇔ |diff| < 0.005 — stricter than the 0.01 asked for.
        expect(ratioOf(pack.tokens, 'light', pair)).toBeCloseTo(light, 2);
        expect(ratioOf(pack.tokens, 'dark', pair)).toBeCloseTo(dark, 2);
      }
    });

    it(`${pack.id}: token schema parses cleanly`, async () => {
      const { themePackSchema } = await import('../theme/index.js');
      expect(() => themePackSchema.parse(pack)).not.toThrow();
    });
  }

  it('validatePackContrast names the failing pair when text equals bg', () => {
    const broken = structuredClone(defaultThemePacks[0]!.tokens);
    broken.light.text = broken.light.bg;
    const failures = validatePackContrast(broken);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.mode === 'light' && f.pair === 'text/bg')).toBe(true);
  });
});
