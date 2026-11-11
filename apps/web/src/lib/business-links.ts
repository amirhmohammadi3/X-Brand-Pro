// apps/web/src/lib/business-links.ts — outbound contact/directions URL builders.
//
// These are USER-clicked navigation hyperlinks: clicking opens the user's
// messenger/maps app in a new tab. They are NOT runtime asset requests the
// browser makes to a third-party host (AGENTS.md §7 forbids those), so each
// third-party host literal below is tagged `// external-ok` per
// scripts/check-no-external.mjs. Runtime-data URLs (the business `website`
// field, already a full URL stored in the DB) carry no source literal and need
// no tag.

/** Normalize a phone to the international digits `wa.me` expects. */
export function whatsappUrl(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  return digits === '' ? null : `https://wa.me/${digits}`; // external-ok
}

/** Telegram: strip a leading `@`. */
export function telegramUrl(handle: string | null): string | null {
  if (!handle) return null;
  const h = handle.replace(/^@/, '').trim();
  return h === '' ? null : `https://t.me/${h}`; // external-ok
}

/** Instagram: strip a leading `@`. */
export function instagramUrl(handle: string | null): string | null {
  if (!handle) return null;
  const h = handle.replace(/^@/, '').trim();
  return h === '' ? null : `https://instagram.com/${h}`; // external-ok
}

/** The `website` field may be stored without a scheme — ensure one before
 * rendering as an href, else the browser treats it as a relative path. */
export function websiteUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`; // external-ok
}

/** Google Maps turn-by-turn directions to the business coordinates. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; // external-ok
}
