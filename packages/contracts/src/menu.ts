import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Menu / services contracts (B2.8). A business menu is two levels — named
 * sections, each holding items with an optional price (RIALS; Iran has no
 * practical subunit, so one integer column of rials avoids float money — see
 * DECISIONS B2.8) and an optional photo. The photo itself is uploaded through
 * B1.9's POST /media/upload with kind `menu_photo`; the replace payload
 * references the returned media id (`photoMediaId`).
 *
 * The whole menu is replaced atomically (PUT /businesses/:id/menu) — the same
 * full-replace semantics B2.5 chose for the weekly hours: the menu is small,
 * owner-managed content where an atomic "save my edits" beats a dozen granular
 * endpoints. Rows are RECREATED on every save (no client-side identity) — the
 * payload snapshot BECOMES the menu; ids in the response are server-issued.
 */

/** Sanity cap for a menu price in rials (1e12 = a thousand tomans × … plenty). */
export const MENU_PRICE_MAX = 1_000_000_000_000;
export const MENU_MAX_SECTIONS = 20;
export const MENU_MAX_ITEMS_PER_SECTION = 50;

/** One menu item as served by GET /businesses/:id/menu. */
export const menuItemSchema = z.object({
  id: uuidSchema,
  sectionId: uuidSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable(),
  /** Rials, ≥ 0; null = "call us" / not priced. */
  price: z.number().int().min(0).max(MENU_PRICE_MAX).nullable(),
  photoUrl: z.string().min(1).nullable(),
  photoThumbUrl: z.string().min(1).nullable(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int().min(0),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

/** One menu section (with its items) as served by GET /businesses/:id/menu. */
export const menuSectionSchema = z.object({
  id: uuidSchema,
  businessId: uuidSchema,
  name: z.string().min(1).max(120),
  sortOrder: z.number().int().min(0),
  items: z.array(menuItemSchema),
});
export type MenuSection = z.infer<typeof menuSectionSchema>;

export const menuResponseSchema = z.object({
  sections: z.array(menuSectionSchema),
});
export type MenuResponse = z.infer<typeof menuResponseSchema>;

/** Item payload of a replace — rows are recreated; no client-side identity. */
export const menuItemInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    price: z.number().int().min(0).max(MENU_PRICE_MAX).nullable().optional(),
    /** Media id from POST /media/upload (kind `menu_photo`), owned by the caller. */
    photoMediaId: uuidSchema.optional(),
    isAvailable: z.boolean().optional(),
  })
  .strict();
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const menuSectionInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    items: z.array(menuItemInputSchema).max(MENU_MAX_ITEMS_PER_SECTION),
  })
  .strict();
export type MenuSectionInput = z.infer<typeof menuSectionInputSchema>;

/** Full-menu replace body — the payload snapshot BECOMES the menu. */
export const replaceMenuBodySchema = z
  .object({
    sections: z.array(menuSectionInputSchema).max(MENU_MAX_SECTIONS),
  })
  .strict();
export type ReplaceMenuBody = z.infer<typeof replaceMenuBodySchema>;
