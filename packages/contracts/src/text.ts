/**
 * Persian/Latin text normalizers shared by api and web.
 * Everything here is pure string-in/string-out — no locale data needed.
 */

/** Persian digits ۰-۹ (U+06F0..U+06F9). */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** Arabic-Indic digits ٠-٩ (U+0660..U+0669). */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const PERSIAN_DIGIT_MAP = new Map<string, string>(
  [...PERSIAN_DIGITS].map((d, i) => [d, String(i)]),
);
const ARABIC_DIGIT_MAP = new Map<string, string>([...ARABIC_DIGITS].map((d, i) => [d, String(i)]));

/**
 * Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII. Leaves ASCII
 * digits and everything else untouched.
 */
export function normalizeDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    out += PERSIAN_DIGIT_MAP.get(ch) ?? ARABIC_DIGIT_MAP.get(ch) ?? ch;
  }
  return out;
}

/** Convert ASCII digits 0-9 to Persian digits ۰-۹. */
export function toPersianDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code >= 0x30 && code <= 0x39 ? PERSIAN_DIGITS[code - 0x30] : ch;
  }
  return out;
}

/** ZWNJ (U+200C). */
const ZWNJ = '\u200c';
/** Tatweel (U+0640) — all occurrences. */
const TATWEEL = /\u0640/g;
/** Arabic diacritics (fathatan..sukun, U+064B..U+065F) + superscript alef (U+0670). */
const DIACRITICS = /[\u064b-\u065f\u0670]/g;

/**
 * Normalize Persian text for search, uniqueness and slugs:
 * - Arabic ي→ی, ك→ک, ة→ه
 * - remove tatweel and Arabic diacritics
 * - NBSP and whitespace runs → single space, trimmed
 * - ZWNJ: removed at word start/end, repeated ZWNJ collapsed to one
 */
export function normalizePersianText(s: string): string {
  let t = s
    .replace(/\u064a/g, '\u06cc') // Arabic yeh -> Farsi yeh
    .replace(/\u0643/g, '\u06a9') // Arabic kaf -> Farsi kaf
    .replace(/\u0629/g, '\u0647') // tehs marbuta -> heh
    .replace(TATWEEL, '')
    .replace(DIACRITICS, '')
    // NBSP and any other Unicode space → single ASCII space, then trim.
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Collapse repeated ZWNJ.
  t = t.replace(new RegExp(`${ZWNJ}{2,}`, 'g'), ZWNJ);
  // ZWNJ at word boundaries (start of string, end of string, or next to a space) is noise.
  t = t.replace(new RegExp(`${ZWNJ}(?= |$)`, 'g'), '');
  t = t.replace(new RegExp(`(^| )${ZWNJ}`, 'g'), '$1');
  return t;
}

/**
 * Build a URL-safe slug: normalizePersianText + lowercase Latin, spaces/ZWNJ/
 * underscores → hyphen, keep Persian letters + Latin letters + digits,
 * collapse hyphens, trim to 80 chars.
 */
export function slugify(s: string): string {
  const t = normalizePersianText(s)
    .toLowerCase()
    .replace(/[ _\u200c]+/g, '-')
    // Keep Persian letters (U+0621..U+064A, U+067E, U+0686, U+0698, U+06A9, U+06AF, U+06CC), a-z, 0-9, hyphen.
    .replace(/[^a-z0-9\u0621-\u064a\u067e\u0686\u0698\u06a9\u06af\u06cc-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return t.slice(0, 80).replace(/-+$/, '');
}
