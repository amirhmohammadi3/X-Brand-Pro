import { z } from 'zod';
import { localizedTextSchema, slugSchema, uuidSchema } from './primitives.js';

/**
 * Cities & neighborhoods catalog contracts (B2.1).
 *
 * `center` is a `{ lat, lng }` pair on the wire (the API translates to/from
 * PostGIS `geography(Point, 4326)` in the repository). `bbox` is the optional
 * bounding box `{ west, south, east, north }` that must contain the center.
 * Timezones are validated as IANA identifiers via `Intl.DateTimeFormat`.
 */

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const geoPointSchema = z.object({ lat: latitudeSchema, lng: longitudeSchema }).strict();
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const bboxSchema = z
  .object({
    west: longitudeSchema,
    south: latitudeSchema,
    east: longitudeSchema,
    north: latitudeSchema,
  })
  .strict()
  .refine((b) => b.east > b.west, { message: 'east must be greater than west' })
  .refine((b) => b.north > b.south, { message: 'north must be greater than south' });
export type Bbox = z.infer<typeof bboxSchema>;

/** IANA timezone validation via Intl (no timezone DB dependency). */
export const ianaTimezoneSchema = z
  .string()
  .min(3)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid IANA timezone');

const sortOrderSchema = z.number().int().min(0).max(100000);

/** A city row as seen by admin endpoints (includes activation flag + order). */
export const citySchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    name: localizedTextSchema,
    center: geoPointSchema,
    bbox: bboxSchema.nullable(),
    timezone: ianaTimezoneSchema,
    isActive: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type City = z.infer<typeof citySchema>;

/** A city as seen by public endpoints (no activation/order). `isDefault` is
 * set by the service from the `geo.defaultCitySlug` public setting. */
export const publicCitySchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    name: localizedTextSchema,
    center: geoPointSchema,
    bbox: bboxSchema.nullable(),
    timezone: ianaTimezoneSchema,
    isDefault: z.boolean(),
  })
  .strict();
export type PublicCity = z.infer<typeof publicCitySchema>;

export const neighborhoodSchema = z
  .object({
    id: uuidSchema,
    cityId: uuidSchema,
    slug: slugSchema,
    name: localizedTextSchema,
    center: geoPointSchema,
    isActive: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type Neighborhood = z.infer<typeof neighborhoodSchema>;

/** `center` must lie inside `bbox` when both are supplied (no-op otherwise). */
function centerInBbox(center: GeoPoint | null | undefined, bbox: Bbox | null | undefined): boolean {
  if (!center || !bbox) return true;
  return (
    center.lng >= bbox.west &&
    center.lng <= bbox.east &&
    center.lat >= bbox.south &&
    center.lat <= bbox.north
  );
}

export const createCityBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedTextSchema,
    center: geoPointSchema,
    bbox: bboxSchema.nullable().optional(),
    timezone: ianaTimezoneSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict()
  .refine((b) => centerInBbox(b.center, b.bbox ?? null), {
    message: 'center must lie within bbox',
    path: ['center'],
  });
export type CreateCityBody = z.infer<typeof createCityBodySchema>;

export const updateCityBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedTextSchema.optional(),
    center: geoPointSchema.optional(),
    bbox: bboxSchema.nullable().optional(),
    timezone: ianaTimezoneSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict()
  .refine((b) => centerInBbox(b.center ?? null, b.bbox ?? null), {
    message: 'center must lie within bbox',
    path: ['center'],
  });
export type UpdateCityBody = z.infer<typeof updateCityBodySchema>;

export const setActiveCityBodySchema = z.object({ isActive: z.boolean() }).strict();
export type SetActiveCityBody = z.infer<typeof setActiveCityBodySchema>;

export const reorderCitiesBodySchema = z
  .object({ ids: z.array(uuidSchema).min(1).max(500) })
  .strict();
export type ReorderCitiesBody = z.infer<typeof reorderCitiesBodySchema>;

export const createNeighborhoodBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedTextSchema,
    center: geoPointSchema,
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();
export type CreateNeighborhoodBody = z.infer<typeof createNeighborhoodBodySchema>;

export const updateNeighborhoodBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedTextSchema.optional(),
    center: geoPointSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();
export type UpdateNeighborhoodBody = z.infer<typeof updateNeighborhoodBodySchema>;

export const reorderNeighborhoodsBodySchema = z
  .object({ ids: z.array(uuidSchema).min(1).max(500) })
  .strict();
export type ReorderNeighborhoodsBody = z.infer<typeof reorderNeighborhoodsBodySchema>;

/** Admin city listing item carries neighborhood + business counts. */
export const adminCitySchema = citySchema.extend({
  neighborhoodCount: z.number().int().min(0),
  businessCount: z.number().int().min(0),
});
export type AdminCity = z.infer<typeof adminCitySchema>;
