import { z } from 'zod';
import { normalizeDigits } from './text.js';

/** UUID v4 (any valid UUID accepted for input flexibility). */
export const uuidSchema = z.string().uuid();

/** URL slug: lowercase Latin letters, Persian letters, digits, hyphens. */
export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9\u0621-\u064a\u067e\u0686\u0698\u06a9\u06af\u06cc-]+$/);

const RESERVED_USERNAMES = new Set([
  'admin',
  'root',
  'support',
  'api',
  'www',
  'me',
  'system',
  'null',
  'undefined',
]);

/** Username: 3–30 chars, `^[a-z0-9_]+$` after lowercasing+trimming, must start with a letter. */
export const usernameSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z][a-z0-9_]*$/, 'must start with a letter and use only a-z, 0-9, _'),
  )
  .refine((s) => !RESERVED_USERNAMES.has(s), { message: 'username is reserved' });

/** Email: trimmed, lowercased, max 254 chars, minimal RFC shape. */
export const emailSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(
    z
      .string()
      .max(254)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/),
  );

/**
 * Iranian mobile number → E.164 `+989xxxxxxxxx`.
 * Accepts `09xxxxxxxxx`, `9xxxxxxxxx`, `+989xxxxxxxxx`, `00989xxxxxxxxx`
 * (with optional spaces, dashes, parentheses and Persian/Arabic digits).
 * The operator digit after `9` must be 0–3 or 9 per Iranian mobile ranges.
 */
export const iranMobileSchema = z
  .string()
  .transform((s) => normalizeDigits(s).replace(/[\s\-()]/g, ''))
  .pipe(
    z.string().regex(/^(?:\+98|0098|0|98)?9([0-3]|9)\d{8}$/, 'not a valid Iranian mobile number'),
  )
  .transform((s) => {
    // Strip the country/local prefixes down to the 10-digit local form.
    const local = s.replace(/^(?:\+98|0098|98|0)/, '');
    return `+98${local}`;
  });

/** Password: 8–128 chars, at least one letter and one digit. */
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/, 'must contain a letter')
  .regex(/\d/, 'must contain a digit');

/** Locale code: `fa`, `en`, `fa-IR`, `en-US` (lowercase language, optional uppercase region). */
export const localeCodeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/** Localized text map `{ fa: "...", en: "..." }` — `fa` is required and non-empty. */
export const localizedTextSchema = z
  .record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string())
  .refine((v) => typeof v.fa === 'string' && v.fa.trim().length > 0, {
    message: 'fa (Persian) text is required',
  });
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** ISO-8601 date or datetime string that `new Date()` can parse. */
export const isoDateSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid ISO date' });

/** Money in Rials: non-negative safe integer (never a float — see AGENTS.md §6). */
export const moneyIrrSchema = z.number().int().min(0).safe();
