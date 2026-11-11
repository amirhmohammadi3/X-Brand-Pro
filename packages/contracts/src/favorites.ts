import { z } from 'zod';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { uuidSchema } from './primitives.js';
import { businessSummarySchema } from './business.js';

/**
 * Favorites and named lists (B5.1). A user saves businesses into lists:
 * every account owns ONE implicit default list («علاقه‌مندی‌ها», created
 * lazily on the first write — a read must never pay a write) plus up to
 * FAVORITE_MAX_LISTS_PER_USER named lists. One design decision governs the
 * whole module: **a business sits in AT MOST ONE list per user** —
 * `favorite_items` carries a denormalised `user_id` with the
 * `favorite_items_one_per_user` UNIQUE (user_id, business_id) index, so:
 *
 * - the heart state is one indexed probe (`WHERE user_id = me AND
 *   business_id = x`), never a fan-out over lists;
 * - a named list is a MOVE (`PATCH /favorites/items/:id { listId }`), not a
 *   copy — duplicates would make the heart ambiguous;
 * - re-adding an already-favorited business is a 409, not a silent upsert
 *   (the client can PATCH the note/listId instead — the error is the signal).
 *
 * Deleting a list cascades its items (the businesses leave favorites
 * entirely when their only list goes; the default list can never be
 * deleted, so the heart never dies with a named list).
 */

export const FAVORITE_LIST_NAME_MIN = 1;
export const FAVORITE_LIST_NAME_MAX = 80;
export const FAVORITE_NOTE_MAX = 280;
/** Named lists + the implicit default, per user. */
export const FAVORITE_MAX_LISTS_PER_USER = 50;
/** Per single list (default included). */
export const FAVORITE_MAX_ITEMS_PER_LIST = 500;

/**
 * Rate-limit rules (single source of truth for controller + tests):
 * - writes are one indexed insert/delete each (user-scoped, owner-speed) →
 *   30/min per user, the QA-write budget;
 * - reads → 60/min per user (scope user — favorites are private, ip scope
 *   would let strangers burn each other's budget).
 */
export const FAVORITE_WRITE_LIMIT_PER_MIN = 30;
export const FAVORITE_READ_LIMIT_PER_MIN = 60;

/** The implicit default list's stored name (UI renders its own i18n label for isDefault rows). */
export const FAVORITE_DEFAULT_LIST_NAME = 'علاقه‌مندی‌ها';

/** One list as served by GET /favorites/me (item count joined inline). */
export const favoriteListSummarySchema = z
  .object({
    id: uuidSchema,
    name: z.string().min(FAVORITE_LIST_NAME_MIN).max(FAVORITE_LIST_NAME_MAX),
    isDefault: z.boolean(),
    itemCount: z.number().int().min(0),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type FavoriteListSummary = z.infer<typeof favoriteListSummarySchema>;

/** GET /favorites/me — the caller's lists (default first, then newest). */
export const myFavoriteListsResultSchema = z
  .object({ lists: z.array(favoriteListSummarySchema) })
  .strict();
export type MyFavoriteListsResult = z.infer<typeof myFavoriteListsResultSchema>;

/** One saved business, as a raw write result (no card — the card read is the list endpoint). */
export const favoriteItemSchema = z
  .object({
    id: uuidSchema,
    listId: uuidSchema,
    businessId: uuidSchema,
    note: z.string().max(FAVORITE_NOTE_MAX).nullable(),
    createdAt: z.string(),
  })
  .strict();
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;

/** One saved business joined with the B2.4 business summary card. */
export const favoriteListItemSchema = z
  .object({
    id: uuidSchema,
    businessId: uuidSchema,
    note: z.string().max(FAVORITE_NOTE_MAX).nullable(),
    createdAt: z.string(),
    business: businessSummarySchema,
  })
  .strict();
export type FavoriteListItem = z.infer<typeof favoriteListItemSchema>;

/** GET /favorites/lists/:id/items — page-based, newest first. */
export const favoriteListItemsResultSchema = z
  .object({
    items: z.array(favoriteListItemSchema),
    meta: pageMetaSchema,
  })
  .strict();
export type FavoriteListItemsResult = z.infer<typeof favoriteListItemsResultSchema>;

/** POST /favorites/lists body. */
export const createFavoriteListBodySchema = z
  .object({
    name: z.string().trim().min(FAVORITE_LIST_NAME_MIN).max(FAVORITE_LIST_NAME_MAX),
  })
  .strict();
export type CreateFavoriteListBody = z.infer<typeof createFavoriteListBodySchema>;

/** PATCH /favorites/lists/:id body — rename only (membership changes are item-level). */
export const updateFavoriteListBodySchema = z
  .object({
    name: z.string().trim().min(FAVORITE_LIST_NAME_MIN).max(FAVORITE_LIST_NAME_MAX),
  })
  .strict();
export type UpdateFavoriteListBody = z.infer<typeof updateFavoriteListBodySchema>;

/** POST /favorites/lists/:id/items body. */
export const addFavoriteItemBodySchema = z
  .object({
    businessId: uuidSchema,
    note: z.string().trim().min(1).max(FAVORITE_NOTE_MAX).optional(),
  })
  .strict();
export type AddFavoriteItemBody = z.infer<typeof addFavoriteItemBodySchema>;

/** PATCH /favorites/items/:id body — move between lists and/or edit the note. */
export const updateFavoriteItemBodySchema = z
  .object({
    listId: uuidSchema.optional(),
    note: z.string().trim().min(1).max(FAVORITE_NOTE_MAX).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateFavoriteItemBody = z.infer<typeof updateFavoriteItemBodySchema>;

/** GET /favorites/me/check?businessId=… — the heart state, one indexed probe. */
export const favoriteStatusQuerySchema = z.object({ businessId: uuidSchema });
export type FavoriteStatusQuery = z.infer<typeof favoriteStatusQuerySchema>;

export const favoriteStatusResultSchema = z
  .object({
    businessId: uuidSchema,
    favorited: z.boolean(),
    /** The list currently holding the business (null when not favorited). */
    listId: uuidSchema.nullable(),
    listName: z.string().nullable(),
    itemId: uuidSchema.nullable(),
  })
  .strict();
export type FavoriteStatusResult = z.infer<typeof favoriteStatusResultSchema>;

/** DELETE results (mirrors the QA/reviews delete contract shape). */
export const deleteFavoriteItemResultSchema = z.object({ deleted: z.boolean() }).strict();
export type DeleteFavoriteItemResult = z.infer<typeof deleteFavoriteItemResultSchema>;
export const deleteFavoriteListResultSchema = z.object({ deleted: z.boolean() }).strict();
export type DeleteFavoriteListResult = z.infer<typeof deleteFavoriteListResultSchema>;

/** List query (named lists only — the default list is never addressed by name). */
export const favoriteListQuerySchema = pageQuerySchema;
export type FavoriteListQuery = z.infer<typeof favoriteListQuerySchema>;
