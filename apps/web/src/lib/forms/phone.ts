import { toAsciiDigits } from './digits';

/**
 * Iranian phone normalization (F1.4). Converts the many local forms users
 * type into a single canonical E.164 string suitable for the API and Zod
 * schemas:
 *
 *   "0912 345 6789"        → "+989123456789"
 *   "۰۹۱۲۳۴۵۶۷۸۹"          → "+989123456789"   (Persian digits)
 *   "+98 912 345 6789"     → "+989123456789"
 *   "0098 912 345 6789"    → "+989123456789"
 *   "9123456789"           → "+989123456789"   (missing leading 0)
 *
 * Non-digit characters (spaces, dashes, parentheses) are stripped first.
 * Returns the empty string for blank input, and the cleaned input unchanged
 * when it does not look like an Iranian mobile number (so an obviously
 * invalid value still reaches the Zod validator and produces a real error).
 */
export function normalizeIranianPhone(input: string): string {
  if (!input) return '';
  // 1. Persian/Arabic digits → ASCII.
  let s = toAsciiDigits(input);
  // 2. Keep only digits and a leading '+'.
  const hasPlus = s.trim().startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return '';

  if (hasPlus) {
    // Already international; just prepend '+'.
    return `+${s}`;
  }
  if (s.startsWith('00')) {
    // 0098... → +98...
    return `+${s.slice(2)}`;
  }
  if (s.startsWith('0')) {
    // 0912... → +98912...
    return `+98${s.slice(1)}`;
  }
  if (s.startsWith('98')) {
    // 98912... → +98912...
    return `+${s}`;
  }
  // 9123456789 → +989123456789 (assume missing trunk zero)
  return `+98${s}`;
}

/**
 * National display format for an Iranian mobile: groups the 10 digits after
 * the trunk 0 as "0912 345 6789". Input may already be E.164.
 */
export function toIranianNationalDisplay(input: string): string {
  if (!input) return '';
  let s = toAsciiDigits(input).replace(/[^\d]/g, '');
  if (s.startsWith('98')) s = `0${s.slice(2)}`;
  else if (!s.startsWith('0')) s = `0${s}`;
  // s is now like "09123456789" (11 digits).
  if (s.length <= 4) return s;
  if (s.length <= 7) return `${s.slice(0, 4)} ${s.slice(4)}`;
  return `${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7, 11)}`;
}
