import { describe, expect, it } from 'vitest';
import {
  defaultThemePacks,
  type ThemePack,
  type ThemePackId,
  type ThemeTokens,
} from '@app/contracts';
import { escapeForStyleBlock, tokensToCss } from '../src/lib/theme/tokens-to-css';

function pack(id: ThemePackId): ThemeTokens {
  const found = defaultThemePacks.find((p: ThemePack) => p.id === id);
  if (!found) throw new Error(`missing pack ${id}`);
  return found.tokens;
}

describe('tokensToCss', () => {
  it('produces deterministic, sorted output for all three packs', () => {
    const outputs = defaultThemePacks.map((p: ThemePack) => tokensToCss(p.tokens));
    for (const css of outputs) {
      // Every required token appears as a CSS variable.
      expect(css).toContain('--tok-bg:');
      expect(css).toContain('--tok-surface:');
      expect(css).toContain('--tok-surface-alt:');
      expect(css).toContain('--tok-primary:');
      expect(css).toContain('--tok-border-subtle:');
      expect(css).toContain('--tok-overlay:');
      // Shape tokens.
      expect(css).toContain('--radius-sm:');
      expect(css).toContain('--radius-md:');
      expect(css).toContain('--radius-lg:');
      expect(css).toContain('--control-h:');
      expect(css).toContain('--card-p:');
      expect(css).toContain('--heading-weight:');
      expect(css).toContain('--latin-heading-ls:');
      // Shadow tokens for both modes.
      expect(css).toContain('--shadow-sm:');
      expect(css).toContain('--shadow-sm-dark:');
      // Layout attributes exposed as CSS custom properties.
      expect(css).toContain('--card-style:');
      expect(css).toContain('--header-style:');
      expect(css).toContain('--density:');
      // Both mode selectors present.
      expect(css).toContain("[data-mode='light']");
      expect(css).toContain("[data-mode='dark']");
    }
  });

  it('is stable across two calls (no random ordering)', () => {
    const tokens: ThemeTokens = pack('modern');
    expect(tokensToCss(tokens)).toBe(tokensToCss(tokens));
  });

  it('uses the modern pack radius/heading values verbatim', () => {
    const css = tokensToCss(pack('modern'));
    expect(css).toContain('--radius-sm: 6px;');
    expect(css).toContain('--radius-md: 10px;');
    expect(css).toContain('--radius-lg: 16px;');
    expect(css).toContain('--control-h: 36px;');
    expect(css).toContain('--card-p: 16px;');
    expect(css).toContain('--heading-weight: 600;');
  });

  it('uses the luxe pack letter-spacing value', () => {
    const luxe = defaultThemePacks.find((p: ThemePack) => p.id === 'luxe')!;
    const css = tokensToCss(luxe.tokens);
    expect(css).toContain('--latin-heading-ls: 0.04em;');
    expect(css).toContain('--card-style: bordered;');
    expect(css).toContain('--header-style: transparent-on-hero;');
  });

  it('uses the warm pack elevated card style', () => {
    const warm = defaultThemePacks.find((p: ThemePack) => p.id === 'warm')!;
    const css = tokensToCss(warm.tokens);
    expect(css).toContain('--card-style: elevated;');
    expect(css).toContain('--header-style: solid;');
    expect(css).toContain('--density: comfortable;');
  });

  it('does not contain a closing </style> sequence (safe to inject)', () => {
    for (const p of defaultThemePacks) {
      expect(tokensToCss(p.tokens)).not.toContain('</');
    }
  });
  it('escapes a malicious </style> injected into a token value', () => {
    const base = pack('modern');
    const tokens: ThemeTokens = {
      ...base,
      light: { ...base.light, bg: '</style><script>' },
    };
    const css = tokensToCss(tokens);
    expect(css).not.toContain('</style>');
    expect(css).toContain('<\\/style><script>');
  });
});

describe('escapeForStyleBlock', () => {
  it('leaves a normal hex color untouched', () => {
    expect(escapeForStyleBlock('#F6F7FB')).toBe('#F6F7FB');
  });

  it('escapes the only sequence that can close a style element', () => {
    expect(escapeForStyleBlock('</style>')).toBe('<\\/style>');
    expect(escapeForStyleBlock('a</b')).toBe('a<\\/b');
  });
});
