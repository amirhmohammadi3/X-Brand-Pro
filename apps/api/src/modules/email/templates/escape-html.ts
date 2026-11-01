/**
 * The single HTML-escaping point for email templates (B1.6). Every variable
 * interpolated into an email body passes through here — tested with hostile
 * payloads (script tags, quotes) in email.templates.spec.ts.
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}
