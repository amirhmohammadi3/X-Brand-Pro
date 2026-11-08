import { z } from 'zod';
import { emailSchema, iranMobileSchema, uuidSchema, slugSchema } from './primitives.js';
import { normalizeDigits } from './text.js';
import { geoPointSchema, type GeoPoint } from './catalog.js';

/**
 * Business catalog contracts (B2.4).
 *
 * The core business entity: a real-world named place (cafe, clinic, shop…)
 * located by a PostGIS point, owned by a user, categorised, amenity-tagged and
 * lifecycle-managed through a status state machine. `name` is a SINGLE string
 * (the owner's own spelling in any script) — businesses are real-world named
 * entities, not translatable copy; `nameAlt` carries the second script when
 * relevant (see DECISIONS B2.4). Contacts are normalised at the edge:
 * Iranian phones (landline or mobile) → E.164, Instagram/Telegram handles
 * extracted from full URLs, WhatsApp → E.164 mobile.
 */

// ─── Enums ────────────────────────────────────────────────────────────────

export const BUSINESS_STATUSES = [
  'draft',
  'pending',
  'active',
  'suspended',
  'rejected',
  'closed',
] as const;
export const businessStatusSchema = z.enum(BUSINESS_STATUSES);
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

/** Price tier 1 (cheapest) .. 4 (most expensive); null = not set. */
export const priceLevelSchema = z.number().int().min(1).max(4);
export type PriceLevel = z.infer<typeof priceLevelSchema>;

/** Where a business row originated — `manual` (a user typed it) or `import`. */
export const BUSINESS_SOURCES = ['manual', 'import'] as const;
export const businessSourceSchema = z.enum(BUSINESS_SOURCES);
export type BusinessSource = (typeof BUSINESS_SOURCES)[number];

// ─── Contact schemas (normalised at the edge) ─────────────────────────────

/** Iranian phone: mobile (→ +989xxxxxxxxx) OR landline (→ +9821xxxxxxxx).
 * Accepts `09…`/`9…`/`+989…`/`00989…` (mobile) and `021xxxxxxxx` /
 * `+9821xxxxxxxx` / bare `2112345678` (landline) with optional spaces, dashes,
 * parentheses and Persian/Arabic digits. Landline area code may be any 1-3
 * digit prefix whose first digit is 1-8 (so `09…` stays a mobile). */
const landlineLocal = /^0[1-8]\d{9}$/; // 0 + area(1-3, starts 1-8) + subscriber → 11 digits
const landlineIntl = /^(?:\+98|0098|98)?[1-8]\d{9}$/; // no leading 0
const mobileRe = /^(?:\+98|0098|98|0)?9([0-3]|9)\d{8}$/;

export const iranPhoneSchema = z
  .string()
  .transform((s) => normalizeDigits(s).replace(/[\s\-()]/g, ''))
  .pipe(
    z.string().refine((v) => mobileRe.test(v) || landlineLocal.test(v) || landlineIntl.test(v), {
      message: 'not a valid Iranian phone (mobile or landline)',
    }),
  )
  .transform((s) => {
    if (mobileRe.test(s)) {
      const local = s.replace(/^(?:\+98|0098|98|0)/, '');
      return `+98${local}`;
    }
    // landline: drop country/local prefix and the leading 0, then re-add +98
    const local = s.replace(/^(?:\+98|0098|98|0)?/, '');
    return `+98${local}`;
  });

/** Instagram handle: `name.dots_ok` (≤30, [A-Za-z0-9._]). Accepts a full
 * `https://instagram.com/<handle>` URL and extracts the handle. Lowercased. */
export const instagramHandleSchema = z
  .string()
  .transform((s) => {
    const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
    return m ? m[1] : s.trim().replace(/^@/, '');
  })
  .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'not a valid Instagram handle'))
  .transform((h) => h.toLowerCase());

/** Telegram handle: 5-32 chars, `[A-Za-z0-9_]`, must start with a letter.
 * Accepts `https://t.me/<handle>` and `@handle`. Lowercased. */
export const telegramHandleSchema = z
  .string()
  .transform((s) => {
    const m = s.match(/t\.me\/([A-Za-z0-9_]+)/i);
    return m ? m[1] : s.trim().replace(/^@/, '');
  })
  .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/, 'not a valid Telegram handle'))
  .transform((h) => h.toLowerCase());

/** Website URL: http or https, ≤300 chars. */
export const websiteSchema = z
  .string()
  .max(300)
  .refine((v) => /^https?:\/\//i.test(v) && Number.isNaN(Number(v)) === true, {
    message: 'must be an http(s) URL',
  })
  .refine((v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid URL');

/** WhatsApp: an Iranian mobile number, or a `https://wa.me/<digits>` URL,
 * normalised to E.164 `+989xxxxxxxxx`. */
export const whatsappSchema = z
  .string()
  .transform((s) => {
    const m = s.match(/wa\.me\/(\+?\d+)/i);
    return m ? m[1] : s;
  })
  .pipe(iranMobileSchema);

// ─── Reference shapes (joined rows) ───────────────────────────────────────

const localizedRefName = z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string());

/** Primary category / city / neighborhood reference: id + slug + localized name. */
export const businessPlaceRefSchema = z
  .object({ id: uuidSchema, slug: slugSchema, name: localizedRefName })
  .strict();
export type BusinessPlaceRef = z.infer<typeof businessPlaceRefSchema>;

/** A category on a business detail, with its primary flag. */
export const businessCategoryRefSchema = z
  .object({ id: uuidSchema, slug: slugSchema, name: localizedRefName, isPrimary: z.boolean() })
  .strict();
export type BusinessCategoryRef = z.infer<typeof businessCategoryRefSchema>;

/** An amenity on a business detail: id + slug + localized name + icon. */
export const businessAmenityRefSchema = z
  .object({ id: uuidSchema, slug: slugSchema, name: localizedRefName, icon: z.string() })
  .strict();
export type BusinessAmenityRef = z.infer<typeof businessAmenityRefSchema>;

// ─── Summary & detail ─────────────────────────────────────────────────────

export const businessSummarySchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    name: z.string().min(1).max(200),
    nameAlt: z.string().max(200).nullable(),
    primaryCategory: businessPlaceRefSchema,
    city: businessPlaceRefSchema,
    neighborhood: businessPlaceRefSchema.nullable(),
    address: z.string().min(1).max(500),
    location: geoPointSchema,
    priceLevel: priceLevelSchema.nullable(),
    avgRating: z.number().min(0).max(5),
    reviewCount: z.number().int().min(0),
    coverUrl: z.string().nullable(),
    thumbUrl: z.string().nullable(),
    isFeatured: z.boolean(),
    isClaimed: z.boolean(),
  })
  .strict();
export type BusinessSummary = z.infer<typeof businessSummarySchema>;

export const businessDetailSchema = businessSummarySchema.extend({
  /** The owning user's id (null when unclaimed). Exposed so a client can tell
   * "this is mine" and show manage controls; a UUID is not guessable PII and
   * management still requires the owner's session. */
  ownerId: uuidSchema.nullable(),
  description: z.string().max(5000).nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  telegram: z.string().nullable(),
  instagram: z.string().nullable(),
  website: z.string().nullable(),
  email: emailSchema.nullable(),
  amenities: z.array(businessAmenityRefSchema),
  categories: z.array(businessCategoryRefSchema),
  tags: z.array(z.string().min(1).max(60)),
  status: businessStatusSchema,
  source: businessSourceSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BusinessDetail = z.infer<typeof businessDetailSchema>;

/** The subset of contact fields a create/update body may carry (B2.6 owns the
 * full CRUD; B2.4 only defines the normalisers + repository so later prompts
 * reuse them). Each field is optional + nullable so partial updates work. */
export const businessContactsSchema = z
  .object({
    phone: iranPhoneSchema.nullable().optional(),
    whatsapp: whatsappSchema.nullable().optional(),
    telegram: telegramHandleSchema.nullable().optional(),
    instagram: instagramHandleSchema.nullable().optional(),
    website: websiteSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
  })
  .strict();
export type BusinessContacts = z.infer<typeof businessContactsSchema>;

// ─── CRUD bodies (B2.6) ───────────────────────────────────────────────────
//
// B2.6 owns the HTTP layer over the B2.4 repository + domain rules. A business
// is registered by its owner (any authenticated user becomes the owner of what
// they create; the `ownerId` relationship — not the `owner` role tag — drives
// manage access, see business-access.ts). New businesses start `pending`; the
// status state machine (businesses.domain.ts) governs every later transition.

/** The editable scalar fields of a business, shared by create + update. */
const businessEditableFields = {
  name: z.string().min(1).max(200),
  nameAlt: z.string().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  cityId: uuidSchema,
  neighborhoodId: uuidSchema.nullable().optional(),
  primaryCategoryId: uuidSchema,
  /** Secondary categories (the primary is always linked). `categoryIds` need
   * not repeat `primaryCategoryId`; the repository merges it in. */
  categoryIds: z.array(uuidSchema).max(20).optional(),
  amenityIds: z.array(uuidSchema).max(100).optional(),
  address: z.string().min(1).max(500),
  location: geoPointSchema,
  priceLevel: priceLevelSchema.nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(50).optional(),
  phone: iranPhoneSchema.nullable().optional(),
  whatsapp: whatsappSchema.nullable().optional(),
  telegram: telegramHandleSchema.nullable().optional(),
  instagram: instagramHandleSchema.nullable().optional(),
  website: websiteSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
};

/** Create body — the owner registers a business; it starts `pending`. */
export const createBusinessBodySchema = z.object(businessEditableFields).strict();
export type CreateBusinessBody = z.infer<typeof createBusinessBodySchema>;

/** Update body — every field optional; join tables replaced when present. */
export const updateBusinessBodySchema = z.object(businessEditableFields).partial().strict();
export type UpdateBusinessBody = z.infer<typeof updateBusinessBodySchema>;

/**
 * Status transition body. `rejectionReason` is REQUIRED when the target is
 * `rejected` (the only admin moderation that carries a reason) and forbidden
 * otherwise — enforced by the refine so a stray reason on another transition
 * is rejected at the edge.
 */
export const businessTransitionBodySchema = z
  .object({
    status: businessStatusSchema,
    rejectionReason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((b) => (b.status === 'rejected') === !!b.rejectionReason, {
    message: 'rejectionReason is required when rejecting and forbidden otherwise',
    path: ['rejectionReason'],
  });
export type BusinessTransitionBody = z.infer<typeof businessTransitionBodySchema>;

export type { GeoPoint };
