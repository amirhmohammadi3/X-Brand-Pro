import { BRAND } from '@app/config';
import { escapeHtml } from './escape-html.js';

export type TemplateLocale = 'fa' | 'en';

/**
 * Shared, RTL-aware email layout (B1.6): table-based (survives Outlook),
 * 600 px max width, inline CSS only, no remote images, brand name from the
 * single brand source. `dir`/`lang` follow the locale so fa mails render
 * right-to-left in every client.
 *
 * `title` and `bodyHtml` arrive PRE-ESCAPED from the template builders
 * (escapeHtml is applied to variables exactly once, in the builders) — this
 * function only escapes its own internal brand constants.
 */
export function layoutEmail(locale: TemplateLocale, title: string, bodyHtml: string): string {
  const dir = locale === 'fa' ? 'rtl' : 'ltr';
  const lang = locale;
  const align = locale === 'fa' ? 'right' : 'left';
  const brandName = locale === 'fa' ? BRAND.nameFa : BRAND.nameEn;
  const tagline = BRAND.tagline[locale];

  return `<!doctype html>
<html dir="${dir}" lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:20px 24px;text-align:${align};background-color:#111827;">
          <span style="color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(brandName)}</span>
        </td></tr>
        <tr><td style="padding:24px;text-align:${align};color:#111827;font-size:14px;line-height:1.8;">
          <h1 style="margin:0 0 16px;font-size:18px;color:#111827;">${escapeHtml(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;text-align:${align};color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
          ${escapeHtml(tagline)}<br>${escapeHtml(BRAND.domain)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
