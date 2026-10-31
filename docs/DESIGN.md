# DESIGN

The only source of truth for visual rules. UI prompts must follow this file. The product has three switchable **Theme Packs** (modern, warm, luxe), each with a light and a dark mode. The super admin switches the active pack from the admin panel without a deploy. Users choose light, dark or system mode themselves.

The design must NOT resemble Yelp: no red brand color, no star-burst logo, no dense list-first layout. The primary experience is a map-centric discovery screen with a draggable results sheet.

## 1. Token model

Tokens are defined ONCE in `packages/contracts/src/theme/packs.ts` (created by prompt B1.13). The values below are the seed. CSS variables are generated from them (prompt F1.2). Components use only semantic Tailwind classes that map to the variables.

Semantic color tokens (every pack, every mode): `bg`, `surface`, `surfaceAlt`, `text`, `muted`, `border` (UI component borders, needs 3:1), `borderSubtle` (decorative hairlines, no ratio required), `primary`, `onPrimary`, `accent`, `success`, `warning`, `danger`, `ring` (focus outline), `overlay`.

Tailwind classes: `bg-bg`, `bg-surface`, `bg-surface-alt`, `text-text`, `text-muted`, `border-border`, `border-border-subtle`, `bg-primary`, `text-on-primary`, `text-accent`, `text-success`, `text-warning`, `text-danger`, `ring-ring`.

Status colors are for text and icons on `surface`/`surfaceAlt`. A status badge is: `surfaceAlt` background + status-colored text + icon (never color alone).

## 2. Theme Pack: modern (default) — dark minimal, map-first

Character: cool neutrals, indigo primary, sharp but friendly, hairline borders, almost no shadow, translucent blurred header, compact density.

| Token        | light              | dark             |
| ------------ | ------------------ | ---------------- |
| bg           | #F6F7FB            | #0B1020          |
| surface      | #FFFFFF            | #141B30          |
| surfaceAlt   | #EDF0F7            | #1B2440          |
| text         | #0F172A            | #E8ECF8          |
| muted        | #475569            | #A6B0CC          |
| border       | #7C879C            | #6B7596          |
| borderSubtle | #E2E8F0            | #2A3452          |
| primary      | #4338CA            | #9AA3FF          |
| onPrimary    | #FFFFFF            | #0B1020          |
| accent       | #0E7490            | #5EEAD4          |
| success      | #166534            | #4ADE80          |
| warning      | #92400E            | #FBBF24          |
| danger       | #B91C1C            | #FCA5A5          |
| ring         | #4338CA            | #9AA3FF          |
| overlay      | rgba(15,23,42,0.5) | rgba(0,0,0,0.65) |

Shape and feel: radius sm 6px, md 10px, lg 16px, full 9999px. Shadows: sm `0 1px 2px rgba(15,23,42,0.06)`, md `0 4px 12px rgba(15,23,42,0.08)`, lg `0 12px 32px rgba(15,23,42,0.12)` (dark mode: same offsets with rgba(0,0,0,0.4)). Density `compact` (control height 36px, card padding 16px). Layout attributes: `card=outlined`, `header=translucent`, `heading-weight=600`, `map-style=light|dark` following mode.

## 3. Theme Pack: warm — friendly, colorful, rounded

Character: cream backgrounds, terracotta primary, teal accent, soft large radii, soft elevated cards, solid colored header, comfortable density.

| Token        | light              | dark             |
| ------------ | ------------------ | ---------------- |
| bg           | #FFF7ED            | #1C1410          |
| surface      | #FFFFFF            | #271C16          |
| surfaceAlt   | #FFEFDC            | #33251D          |
| text         | #2B1B12            | #F7EDE4          |
| muted        | #6B4A38            | #CDB8A8          |
| border       | #9C7A64            | #8A7060          |
| borderSubtle | #F0DCC8            | #40302A          |
| primary      | #B93A0C            | #FB923C          |
| onPrimary    | #FFFFFF            | #1C1410          |
| accent       | #0F766E            | #5EEAD4          |
| success      | #166534            | #4ADE80          |
| warning      | #92400E            | #FCD34D          |
| danger       | #B91C1C            | #FCA5A5          |
| ring         | #B93A0C            | #FB923C          |
| overlay      | rgba(43,27,18,0.5) | rgba(0,0,0,0.65) |

Shape and feel: radius sm 10px, md 16px, lg 24px, full 9999px. Shadows: sm `0 2px 6px rgba(120,53,15,0.10)`, md `0 8px 20px rgba(120,53,15,0.14)`, lg `0 18px 40px rgba(120,53,15,0.18)` (dark: rgba(0,0,0,0.45)). Density `comfortable` (control height 44px, card padding 20px). Layout attributes: `card=elevated`, `header=solid`, `heading-weight=700`, `map-style=light|dark`.

## 4. Theme Pack: luxe — showcase, editorial, restrained

Character: warm ivory and near-black, brass/gold primary, sharp corners, hairline gold borders, generous whitespace, light headings.

| Token        | light               | dark            |
| ------------ | ------------------- | --------------- |
| bg           | #FAF7F2             | #0E0E0E         |
| surface      | #FFFFFF             | #1A1A1A         |
| surfaceAlt   | #F2EDE3             | #242424         |
| text         | #1A1A1A             | #F3EFE6         |
| muted        | #57513F             | #BDB5A3         |
| border       | #8C8366             | #807859         |
| borderSubtle | #E6DFCF             | #2E2C26         |
| primary      | #7A5C0F             | #D4AF37         |
| onPrimary    | #FFFFFF             | #0E0E0E         |
| accent       | #1F2937             | #E5E7EB         |
| success      | #166534             | #4ADE80         |
| warning      | #92400E             | #FBBF24         |
| danger       | #B91C1C             | #FCA5A5         |
| ring         | #7A5C0F             | #D4AF37         |
| overlay      | rgba(26,26,26,0.55) | rgba(0,0,0,0.7) |

Shape and feel: radius sm 2px, md 4px, lg 8px, full 9999px (only for avatars and chips). Shadows: sm `0 1px 0 rgba(26,26,26,0.06)`, md `0 6px 18px rgba(26,26,26,0.10)`, lg `0 20px 48px rgba(26,26,26,0.16)` (dark: rgba(0,0,0,0.5)). Density `spacious` (control height 48px, card padding 28px). Layout attributes: `card=bordered`, `header=transparent-on-hero`, `heading-weight=400`, `letter-spacing-latin-headings=0.04em`, `map-style=light|dark`.

## 5. Verified contrast (WCAG 2.2, computed)

Required: text 4.5:1, UI component borders and focus ring 3:1. Columns: modern-light, modern-dark, warm-light, warm-dark, luxe-light, luxe-dark.

| Pair                   | M-L   | M-D   | W-L   | W-D   | X-L   | X-D   |
| ---------------------- | ----- | ----- | ----- | ----- | ----- | ----- |
| text / bg              | 16.68 | 16.03 | 15.60 | 15.72 | 16.29 | 16.82 |
| text / surface         | 17.85 | 14.47 | 16.56 | 14.39 | 17.40 | 15.17 |
| text / surfaceAlt      | 15.65 | 12.95 | 14.69 | 12.78 | 14.92 | 13.53 |
| muted / bg             | 7.08  | 8.75  | 7.43  | 9.52  | 7.40  | 9.47  |
| muted / surface        | 7.58  | 7.89  | 7.89  | 8.72  | 7.91  | 8.54  |
| muted / surfaceAlt     | 6.64  | 7.07  | 7.00  | 7.74  | 6.78  | 7.62  |
| onPrimary / primary    | 7.90  | 8.17  | 5.72  | 8.02  | 6.24  | 9.18  |
| primary / bg           | 7.38  | 8.17  | 5.38  | 8.02  | 5.84  | 9.18  |
| primary / surface      | 7.90  | 7.37  | 5.72  | 7.34  | 6.24  | 8.28  |
| accent / surface       | 5.36  | 11.55 | 5.47  | 11.23 | 14.68 | 14.06 |
| success / surface      | 7.13  | 9.80  | 7.13  | 9.53  | 7.13  | 9.99  |
| warning / surface      | 7.09  | 10.23 | 7.09  | 11.52 | 7.09  | 10.43 |
| danger / surface       | 6.47  | 9.00  | 6.47  | 8.75  | 6.47  | 9.17  |
| border / surface (3:1) | 3.62  | 3.75  | 3.90  | 3.61  | 3.78  | 3.94  |
| border / bg (3:1)      | 3.38  | 4.16  | 3.68  | 3.95  | 3.54  | 4.37  |
| ring / bg (3:1)        | 7.38  | 8.17  | 5.38  | 8.02  | 5.84  | 9.18  |
| ring / surface (3:1)   | 7.90  | 7.37  | 5.72  | 7.34  | 6.24  | 8.28  |

When an admin edits a pack (prompt B1.13) the server recomputes these pairs with the same formula (WCAG relative luminance) and rejects values below the thresholds.

## 6. Typography

- Families (self-hosted): UI and Persian/Arabic script `Vazirmatn` (variable, weights 300 to 800), Latin `Inter` (variable). CSS stack: `"Vazirmatn", "Inter", system-ui, sans-serif`. Digits in Persian locale render with Vazirmatn Persian digits; tabular figures for prices and tables.
- Scale (px): xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48. Persian body line-height 1.85, Latin 1.6, headings 1.4. Minimum body size 16px on mobile for inputs (prevents iOS zoom).
- Heading weight and Latin letter-spacing come from the active pack's layout attributes.
- Never use italic for Persian text. Use weight and color for emphasis.

## 7. Spacing, sizing, grid

- 4px base. Allowed spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.
- Container max width 1280px, page gutters 16px (mobile), 24px (tablet), 32px (desktop).
- Breakpoints: sm 640, md 768, lg 1024, xl 1280, 2xl 1536. Mobile first.
- Minimum touch target 44 by 44px. Focus ring: 2px `ring` color with 2px offset on every interactive element, never removed.
- Z-index scale: base 0, sticky 10, dropdown 20, overlay 30, modal 40, toast 50, map controls 5.

## 8. Components rules

- Buttons: variants primary, secondary, ghost, danger, link; sizes sm md lg; loading state keeps width and disables the button; icon-only buttons require `aria-label`.
- Inputs: visible label always (no placeholder-only), hint and error text under the field, error uses `danger` text plus icon and `aria-describedby`. Required fields marked with text, not only an asterisk.
- Rating: 5 stars, shows value with Persian digits; as an input it is a radio group operable with arrow keys; half stars only for display.
- Cards: style from the active pack (`outlined`, `elevated`, `bordered`).
- Modals: focus trap, close on ESC and overlay click (unless destructive form), return focus to trigger. On mobile dialogs become bottom sheets.
- Toasts: appear at the inline-end bottom on desktop, top center on mobile, 5 seconds, pausable, `role="status"` (`alert` for errors).
- Tables: sticky header, responsive (stack into cards under 768px), sortable headers announce sort state.
- Map screens: full-height map with a results sheet (bottom sheet on mobile, side panel on desktop). Map style and marker colors follow the pack tokens and mode.
- Iconography: lucide-react, 20px default, 1.75 stroke. Directional icons mirror in RTL.
- Motion: durations 150ms (small), 250ms (medium), 350ms (large), easing `cubic-bezier(0.2, 0, 0, 1)`. Respect `prefers-reduced-motion` (no parallax, no auto-playing carousels; fade only).

## 9. Accessibility rules

- WCAG 2.2 AA. Semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, skip-to-content link first in tab order.
- All interactive elements keyboard operable with visible focus. No keyboard traps except intentional modal traps.
- Every image has meaningful `alt` (empty `alt=""` for decorative). Every icon-only control has an accessible name.
- Form errors are announced (`aria-live="polite"`), and focus moves to the first invalid field on submit.
- Color is never the only carrier of meaning.
- Page `lang` and `dir` reflect the active language. Mixed-direction content uses `<bdi>` or `dir="auto"` for user-generated text.
- Axe checks run in Playwright for every page type across the matrix 3 packs x 2 modes x (fa, en).

## 10. Light and dark mode

- Modes: `light`, `dark`, `system`. Stored in cookie `mode`; the server renders `data-mode` before first paint so there is no flash.
- Pack stored in `data-theme` on `<html>`. Both attributes are set server-side from the cookie and the active pack.

## 11. Language and direction rules

- `<html lang="<code>" dir="<rtl|ltr>">` from the language record. Layout uses logical properties only (see AGENTS.md section 8).
- Numbers, dates, currency and relative time through the `format*` helpers only. Text that mixes scripts (brand names, phone numbers) is wrapped in `<bdi>`.
- Never concatenate translated fragments into sentences; use ICU message placeholders.
- Text expansion: layouts must tolerate +40% length. Truncation uses `line-clamp` with a title attribute or expand control.

## 12. State rules

- Loading: skeletons that match the final layout, never a centered spinner for full pages (spinner only inside buttons and small widgets).
- Empty: icon, one-line explanation, one primary action, optional suggestion (for search: nearest category or area).
- Error: plain-language message from `messageKey`, a Retry action, and the request id in small muted text.
- Success: toast for background actions, inline confirmation for forms.
- Offline (PWA): a banner at the top; cached pages remain readable; actions that need network are disabled with an explanation.
