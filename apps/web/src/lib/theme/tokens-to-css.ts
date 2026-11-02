import type { ThemeTokens } from '@app/contracts';

/**
 * Dynamic theme engine — pure CSS generation from validated tokens (F1.2).
 *
 * The server fetches the active pack's `ThemeTokens` (or falls back to the
 * bundled `defaultThemePacks`), runs `tokensToCss` once and injects the
 * result as a single inline `<style id="theme-vars">`. Components keep using
 * the SAME semantic Tailwind classes (`bg-bg`, `text-text`, ...) defined in
 * `globals.css` — only the `--tok-*` runtime values flip when the admin
 * switches the pack or the visitor switches the mode.
 *
 * Output is deterministic (sorted keys) so the snapshot tests in
 * `tokens-to-css.spec.ts` are stable across Node versions.
 */

/** kebab-case of a camelCase color name: `surfaceAlt` → `surface-alt`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const COLOR_ORDER = [
  'bg',
  'surface',
  'surfaceAlt',
  'text',
  'muted',
  'border',
  'borderSubtle',
  'primary',
  'onPrimary',
  'accent',
  'success',
  'warning',
  'danger',
  'ring',
  'overlay',
] as const;

/** Defensive escape so a token value can never break out of the <style> tag. */
function escapeForStyleBlock(value: string): string {
  // The only sequence that can close a <style> element is `</`. A validated
  // token is a hex color or an rgba() string, neither of which contains it,
  // but we escape defensively anyway (AGENTS.md permits dangerouslySetInnerHTML
  // ONLY here because the CSS is generated from validated tokens).
  return value.replace(/<\//g, '<\\/');
}

function colorBlock(mode: 'light' | 'dark', colors: ThemeTokens['light']): string {
  const lines = COLOR_ORDER.map((key) => {
    const value = colors[key as keyof typeof colors] as string;
    return `  --tok-${kebab(key)}: ${escapeForStyleBlock(value)};`;
  });
  const selector = mode === 'light' ? `:root,\n[data-mode='light']` : `[data-mode='dark']`;
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/** Convert one pack's tokens into the CSS text for the `theme-vars` style. */
export function tokensToCss(tokens: ThemeTokens): string {
  const colorBlocks = [colorBlock('light', tokens.light), colorBlock('dark', tokens.dark)];

  // Shape / feel: the same for both modes (radius, control height, card pad).
  const shapeLines = [
    `  --radius-sm: ${tokens.radius.sm}px;`,
    `  --radius-md: ${tokens.radius.md}px;`,
    `  --radius-lg: ${tokens.radius.lg}px;`,
    `  --radius-full: ${tokens.radius.full}px;`,
    `  --control-h: ${tokens.controlHeightPx}px;`,
    `  --card-p: ${tokens.cardPaddingPx}px;`,
    `  --heading-weight: ${tokens.layout.headingWeight};`,
    `  --latin-heading-ls: ${tokens.layout.latinHeadingLetterSpacingEm}em;`,
    `  --shadow-sm: ${escapeForStyleBlock(tokens.shadow.light.sm)};`,
    `  --shadow-md: ${escapeForStyleBlock(tokens.shadow.light.md)};`,
    `  --shadow-lg: ${escapeForStyleBlock(tokens.shadow.light.lg)};`,
    `  --shadow-sm-dark: ${escapeForStyleBlock(tokens.shadow.dark.sm)};`,
    `  --shadow-md-dark: ${escapeForStyleBlock(tokens.shadow.dark.md)};`,
    `  --shadow-lg-dark: ${escapeForStyleBlock(tokens.shadow.dark.lg)};`,
  ];
  const shapeBlock = `:root {\n${shapeLines.join('\n')}\n}`;

  // Layout attributes are read by CSS via attribute selectors, but we also
  // expose them as CSS custom properties so components can branch without a
  // runtime read of the DOM attribute.
  const layoutLines = [
    `  --card-style: ${tokens.layout.card};`,
    `  --header-style: ${tokens.layout.header};`,
    `  --density: ${tokens.density};`,
    `  --map-style-light: light;`,
    `  --map-style-dark: dark;`,
  ];
  const layoutBlock = `:root {\n${layoutLines.join('\n')}\n}`;

  return [shapeBlock, layoutBlock, ...colorBlocks].join('\n\n');
}

/** Escape helper re-exported for the dedicated escaping test. */
export { escapeForStyleBlock };
