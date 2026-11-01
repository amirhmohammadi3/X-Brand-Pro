import type { ThemePack, ThemeTokens } from './tokens.js';

/**
 * The three builtin theme packs (B1.13) — transcribed EXACTLY from
 * docs/DESIGN.md sections 2-4. F1.2 generates CSS variables from these;
 * the seeder inserts them into `theme_packs` insert-if-absent, so admin
 * edits survive reseeds and `resetToDefault` restores these values.
 */

const modernTokens: ThemeTokens = {
  light: {
    bg: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceAlt: '#EDF0F7',
    text: '#0F172A',
    muted: '#475569',
    border: '#7C879C',
    borderSubtle: '#E2E8F0',
    primary: '#4338CA',
    onPrimary: '#FFFFFF',
    accent: '#0E7490',
    success: '#166534',
    warning: '#92400E',
    danger: '#B91C1C',
    ring: '#4338CA',
    overlay: 'rgba(15,23,42,0.5)',
  },
  dark: {
    bg: '#0B1020',
    surface: '#141B30',
    surfaceAlt: '#1B2440',
    text: '#E8ECF8',
    muted: '#A6B0CC',
    border: '#6B7596',
    borderSubtle: '#2A3452',
    primary: '#9AA3FF',
    onPrimary: '#0B1020',
    accent: '#5EEAD4',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#FCA5A5',
    ring: '#9AA3FF',
    overlay: 'rgba(0,0,0,0.65)',
  },
  radius: { sm: 6, md: 10, lg: 16, full: 9999 },
  shadow: {
    light: {
      sm: '0 1px 2px rgba(15,23,42,0.06)',
      md: '0 4px 12px rgba(15,23,42,0.08)',
      lg: '0 12px 32px rgba(15,23,42,0.12)',
    },
    dark: {
      sm: '0 1px 2px rgba(0,0,0,0.4)',
      md: '0 4px 12px rgba(0,0,0,0.4)',
      lg: '0 12px 32px rgba(0,0,0,0.4)',
    },
  },
  density: 'compact',
  controlHeightPx: 36,
  cardPaddingPx: 16,
  layout: {
    card: 'outlined',
    header: 'translucent',
    headingWeight: 600,
    latinHeadingLetterSpacingEm: 0,
  },
};

const warmTokens: ThemeTokens = {
  light: {
    bg: '#FFF7ED',
    surface: '#FFFFFF',
    surfaceAlt: '#FFEFDC',
    text: '#2B1B12',
    muted: '#6B4A38',
    border: '#9C7A64',
    borderSubtle: '#F0DCC8',
    primary: '#B93A0C',
    onPrimary: '#FFFFFF',
    accent: '#0F766E',
    success: '#166534',
    warning: '#92400E',
    danger: '#B91C1C',
    ring: '#B93A0C',
    overlay: 'rgba(43,27,18,0.5)',
  },
  dark: {
    bg: '#1C1410',
    surface: '#271C16',
    surfaceAlt: '#33251D',
    text: '#F7EDE4',
    muted: '#CDB8A8',
    border: '#8A7060',
    borderSubtle: '#40302A',
    primary: '#FB923C',
    onPrimary: '#1C1410',
    accent: '#5EEAD4',
    success: '#4ADE80',
    warning: '#FCD34D',
    danger: '#FCA5A5',
    ring: '#FB923C',
    overlay: 'rgba(0,0,0,0.65)',
  },
  radius: { sm: 10, md: 16, lg: 24, full: 9999 },
  shadow: {
    light: {
      sm: '0 2px 6px rgba(120,53,15,0.10)',
      md: '0 8px 20px rgba(120,53,15,0.14)',
      lg: '0 18px 40px rgba(120,53,15,0.18)',
    },
    dark: {
      sm: '0 2px 6px rgba(0,0,0,0.45)',
      md: '0 8px 20px rgba(0,0,0,0.45)',
      lg: '0 18px 40px rgba(0,0,0,0.45)',
    },
  },
  density: 'comfortable',
  controlHeightPx: 44,
  cardPaddingPx: 20,
  layout: {
    card: 'elevated',
    header: 'solid',
    headingWeight: 700,
    latinHeadingLetterSpacingEm: 0,
  },
};

const luxeTokens: ThemeTokens = {
  light: {
    bg: '#FAF7F2',
    surface: '#FFFFFF',
    surfaceAlt: '#F2EDE3',
    text: '#1A1A1A',
    muted: '#57513F',
    border: '#8C8366',
    borderSubtle: '#E6DFCF',
    primary: '#7A5C0F',
    onPrimary: '#FFFFFF',
    accent: '#1F2937',
    success: '#166534',
    warning: '#92400E',
    danger: '#B91C1C',
    ring: '#7A5C0F',
    overlay: 'rgba(26,26,26,0.55)',
  },
  dark: {
    bg: '#0E0E0E',
    surface: '#1A1A1A',
    surfaceAlt: '#242424',
    text: '#F3EFE6',
    muted: '#BDB5A3',
    border: '#807859',
    borderSubtle: '#2E2C26',
    primary: '#D4AF37',
    onPrimary: '#0E0E0E',
    accent: '#E5E7EB',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#FCA5A5',
    ring: '#D4AF37',
    overlay: 'rgba(0,0,0,0.7)',
  },
  radius: { sm: 2, md: 4, lg: 8, full: 9999 },
  shadow: {
    light: {
      sm: '0 1px 0 rgba(26,26,26,0.06)',
      md: '0 6px 18px rgba(26,26,26,0.10)',
      lg: '0 20px 48px rgba(26,26,26,0.16)',
    },
    dark: {
      sm: '0 1px 0 rgba(0,0,0,0.5)',
      md: '0 6px 18px rgba(0,0,0,0.5)',
      lg: '0 20px 48px rgba(0,0,0,0.5)',
    },
  },
  density: 'spacious',
  controlHeightPx: 48,
  cardPaddingPx: 28,
  layout: {
    card: 'bordered',
    header: 'transparent-on-hero',
    headingWeight: 400,
    latinHeadingLetterSpacingEm: 0.04,
  },
};

/** The shipped packs, in activation order (modern is the default). */
export const defaultThemePacks: readonly ThemePack[] = [
  {
    id: 'modern',
    names: { fa: 'مدرن', en: 'Modern' },
    tokens: modernTokens,
    version: 1,
  },
  {
    id: 'warm',
    names: { fa: 'گرم', en: 'Warm' },
    tokens: warmTokens,
    version: 1,
  },
  {
    id: 'luxe',
    names: { fa: 'لوکس', en: 'Luxe' },
    tokens: luxeTokens,
    version: 1,
  },
];

/** Shipped tokens of one pack (used by `resetToDefault`). */
export function defaultPackTokens(id: ThemePack['id']): ThemeTokens | undefined {
  return defaultThemePacks.find((pack) => pack.id === id)?.tokens;
}
