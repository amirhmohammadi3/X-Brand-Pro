import { z } from 'zod';
import { localizedTextSchema } from '../primitives.js';

/**
 * Theme token contracts (B1.13). Tokens are defined ONCE here (see
 * docs/DESIGN.md section 1); the seed values in `packs.ts` are transcribed
 * from docs/DESIGN.md sections 2-4 and validated against section 5 by
 * `validatePackContrast`.
 */

/** `#RRGGBB` hex color. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB');

/** CSS rgba() string for overlays, e.g. `rgba(0,0,0,0.65)`. */
export const cssRgbaSchema = z
  .string()
  .regex(/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/);

/**
 * The semantic color set. `borderSubtle` is decorative (no contrast
 * requirement); every other color has a required ratio — see contrast.ts.
 */
export const colorSetSchema = z
  .object({
    bg: hexColorSchema,
    surface: hexColorSchema,
    surfaceAlt: hexColorSchema,
    text: hexColorSchema,
    muted: hexColorSchema,
    border: hexColorSchema,
    borderSubtle: hexColorSchema,
    primary: hexColorSchema,
    onPrimary: hexColorSchema,
    accent: hexColorSchema,
    success: hexColorSchema,
    warning: hexColorSchema,
    danger: hexColorSchema,
    ring: hexColorSchema,
    overlay: cssRgbaSchema,
  })
  .strict();
export type ColorSet = z.infer<typeof colorSetSchema>;

export const themeRadiusSchema = z
  .object({
    sm: z.number().min(0).max(64),
    md: z.number().min(0).max(64),
    lg: z.number().min(0).max(64),
    full: z.number().min(0).max(9999),
  })
  .strict();
export type ThemeRadius = z.infer<typeof themeRadiusSchema>;

export const themeShadowSetSchema = z
  .object({
    sm: z.string().min(1).max(200),
    md: z.string().min(1).max(200),
    lg: z.string().min(1).max(200),
  })
  .strict();
export type ThemeShadowSet = z.infer<typeof themeShadowSetSchema>;

export const themeDensitySchema = z.enum(['compact', 'comfortable', 'spacious']);

export const themeLayoutSchema = z
  .object({
    card: z.enum(['outlined', 'elevated', 'bordered']),
    header: z.enum(['translucent', 'solid', 'transparent-on-hero']),
    headingWeight: z.number().int().min(300).max(800),
    latinHeadingLetterSpacingEm: z.number().min(0).max(0.1),
  })
  .strict();
export type ThemeLayout = z.infer<typeof themeLayoutSchema>;

export const themeTokensSchema = z
  .object({
    light: colorSetSchema,
    dark: colorSetSchema,
    radius: themeRadiusSchema,
    shadow: z
      .object({
        light: themeShadowSetSchema,
        dark: themeShadowSetSchema,
      })
      .strict(),
    density: themeDensitySchema,
    controlHeightPx: z.number().int().min(28).max(64),
    cardPaddingPx: z.number().int().min(8).max(48),
    layout: themeLayoutSchema,
  })
  .strict();
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

export const themePackIdSchema = z.enum(['modern', 'warm', 'luxe']);
export type ThemePackId = z.infer<typeof themePackIdSchema>;

export const themePackSchema = z
  .object({
    id: themePackIdSchema,
    names: localizedTextSchema,
    tokens: themeTokensSchema,
    version: z.number().int().min(1),
  })
  .strict();
export type ThemePack = z.infer<typeof themePackSchema>;

/** Admin body: replace the tokens of an existing pack. */
export const updateThemeTokensBodySchema = z
  .object({
    tokens: themeTokensSchema,
  })
  .strict();
export type UpdateThemeTokensBody = z.infer<typeof updateThemeTokensBodySchema>;

/** Admin body: switch the active pack. */
export const setActiveThemeBodySchema = z
  .object({
    packId: themePackIdSchema,
  })
  .strict();
export type SetActiveThemeBody = z.infer<typeof setActiveThemeBodySchema>;

/** Small public preview: 5 colors per mode. */
export const themePreviewSchema = z
  .object({
    id: themePackIdSchema,
    names: localizedTextSchema,
    isActive: z.boolean(),
    version: z.number().int().min(1),
    preview: z
      .object({
        light: z.tuple([
          hexColorSchema,
          hexColorSchema,
          hexColorSchema,
          hexColorSchema,
          hexColorSchema,
        ]),
        dark: z.tuple([
          hexColorSchema,
          hexColorSchema,
          hexColorSchema,
          hexColorSchema,
          hexColorSchema,
        ]),
      })
      .strict(),
  })
  .strict();
export type ThemePreview = z.infer<typeof themePreviewSchema>;

/** Public active-theme payload: full tokens + a cache-busting version string. */
export const activeThemeSchema = z
  .object({
    pack: z
      .object({ id: themePackIdSchema, names: localizedTextSchema, tokens: themeTokensSchema })
      .strict(),
    version: z.string().min(8).max(64),
  })
  .strict();
export type ActiveTheme = z.infer<typeof activeThemeSchema>;
