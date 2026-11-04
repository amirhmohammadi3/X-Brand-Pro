/**
 * Brand configuration (F1.7). Centralizes the brand mark and name so the
 * header, footer and metadata stay consistent. The name is i18n-keyed
 * (`brand.name`) so it renders in the active locale; the mark is a short
 * latin glyph that works in both LTR and RTL.
 */

export interface BrandConfig {
  /** Short latin mark shown in the header/footer wordmark. */
  mark: string;
  /** i18n key for the full brand name. */
  nameKey: string;
  /** i18n key for a one-line tagline (footer). */
  taglineKey: string;
}

export const BRAND: BrandConfig = {
  mark: 'X',
  nameKey: 'brand.name',
  taglineKey: 'brand.tagline',
};
