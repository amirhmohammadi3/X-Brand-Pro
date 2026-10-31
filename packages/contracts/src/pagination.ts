import { z } from 'zod';

/** Page-based list query: `?page=1&pageSize=20` (both coerced from strings). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Cursor-based list query: `?cursor=<opaque>&limit=20`. */
export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** Meta returned with page-based lists. */
export const pageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

/** Meta returned with cursor-based lists. */
export const cursorMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type CursorMeta = z.infer<typeof cursorMetaSchema>;
