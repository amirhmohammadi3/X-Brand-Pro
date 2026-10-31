// Pure helpers for scripts/check-brand.mjs.
import path from 'node:path';

/**
 * Extract brand nameFa and nameEn from the brand.ts source without compiling.
 * Reads the file as text and regexes the string literals.
 * @param {string} brandTsSource
 * @returns {{ nameFa: string, nameEn: string } | null}
 */
export function extractBrandNames(brandTsSource) {
  const faMatch = brandTsSource.match(/nameFa:\s*['"]([^'"]+)['"]/);
  const enMatch = brandTsSource.match(/nameEn:\s*['"]([^'"]+)['"]/);
  if (!faMatch || !enMatch) return null;
  return { nameFa: faMatch[1], nameEn: enMatch[1] };
}

/**
 * Files (posix, relative to repo root) that are allowed to contain the brand
 * name. Everything else tracked by git is scanned.
 */
export const BRAND_ALLOWED_FILES = new Set(
  [
    'packages/config/src/brand.ts',
    'pnpm-lock.yaml',
    'docs/PROGRESS.md',
    'docs/DECISIONS.md',
    'docs/DESIGN.md',
    'docs/API.md',
    'docs/DATA_MODEL.md',
    'docs/SECURITY.md',
    'docs/DEPLOYMENT.md',
  ].map((f) => f.replace(/\\/g, '/')),
);

/**
 * Also allow any file under docs/ and any i18n seed JSON under
 * apps/api/src/modules/i18n/seed/. (i18n seed files legitimately contain the
 * product name as a translated string.)
 * @param {string} posixRelPath
 */
export function isBrandAllowed(posixRelPath) {
  if (BRAND_ALLOWED_FILES.has(posixRelPath)) return true;
  if (posixRelPath.startsWith('docs/')) return true;
  if (posixRelPath.startsWith('apps/api/src/modules/i18n/seed/')) return true;
  if (posixRelPath.endsWith('.svg')) return true; // logo assets
  return false;
}

/**
 * Scan a file's text for occurrences of the brand name (case-insensitive for
 * English, exact for Persian). Returns the first 1-based line number that
 * contains a match, or null.
 * @param {string} fileText
 * @param {{ nameFa: string, nameEn: string }} brand
 * @returns {number | null}
 */
export function findBrandOccurrence(fileText, brand) {
  const lines = fileText.split(/\r?\n/);
  const enLower = brand.nameEn.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(brand.nameFa)) return i + 1;
    if (enLower && line.toLowerCase().includes(enLower)) return i + 1;
  }
  return null;
}

export const __dirname = path.dirname(new URL(import.meta.url).pathname);
