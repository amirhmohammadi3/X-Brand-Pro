// src/lib/format.ts additions live with the other formatters; the localized
// text picker is here because it is a DATA-mapping helper (contracts'
// LocalizedText), not a number/date formatter.
//
// pickLocalized(map, locale) — how every UI surface turns a contracts
// `LocalizedText` ({ fa: required, en: optional, …dynamic }) into a display
// string: the requested locale, falling back to `fa` (the canonical locale
// every row guarantees), then to ANY value, then ''. Pure and unit-testable.
import type { LocalizedText } from '@app/contracts';

export function pickLocalized(map: LocalizedText | null | undefined, locale: string): string {
  if (!map || typeof map !== 'object') return '';
  const direct = (map as Record<string, unknown>)[locale];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const fa = (map as Record<string, unknown>).fa;
  if (typeof fa === 'string' && fa.length > 0) return fa;
  for (const v of Object.values(map as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}
