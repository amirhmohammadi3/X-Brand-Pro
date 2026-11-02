/**
 * Persian/Arabic digit helpers (F1.4).
 *
 * Users type Persian digits (۰۱۲۳۴۵۶۷۸۹) and Arabic-Indic digits
 * (٠١٢٣٤٥٦٧٨٩); on change/blur every form control normalizes them to ASCII
 * before handing the value to react-hook-form, so schemas and the API only
 * ever see ASCII. The display layer converts back to Persian digits in the
 * `fa` locale (see `toDisplayDigits`).
 */

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** Convert any Persian/Arabic digits in `value` to ASCII (0-9). */
export function toAsciiDigits(value: string): string {
  let out = '';
  for (const ch of value) {
    const pi = PERSIAN.indexOf(ch);
    if (pi !== -1) {
      out += String(pi);
      continue;
    }
    const ai = ARABIC.indexOf(ch);
    if (ai !== -1) {
      out += String(ai);
      continue;
    }
    out += ch;
  }
  return out;
}

/** Convert ASCII digits in `value` to Persian digits (for `fa` display). */
export function toPersianDigits(value: string): string {
  return value.replace(/[0-9]/g, (d) => PERSIAN[Number(d)] ?? d);
}

/**
 * Render digits for display: Persian in the `fa` locale, ASCII elsewhere.
 * Non-digit characters pass through untouched.
 */
export function toDisplayDigits(value: string, locale: string): string {
  return locale === 'fa' ? toPersianDigits(value) : value;
}
