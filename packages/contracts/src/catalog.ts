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

// ─── Categories (B2.2) ───────────────────────────────────────────────────
// Two-level tree: a root (parentId null) may have children; a child may NOT
// have children (depth ≤ 2, enforced in the service). Icons are a curated
// allow-list of Lucide names; colors are semantic accent slots (accent-1..8)
// so themes stay contrast-safe — never raw hex.

/** Lucide icon names permitted for a category (≥60, covering food/drink,
 * health/beauty, shopping, services, education, entertainment, travel,
 * automotive, home, sports, pets, art). The web client renders the Lucide
 * icon by this exact name. */
export const CATEGORY_ICONS = [
  // food & drink
  'utensils',
  'coffee',
  'pizza',
  'ice-cream',
  'cake',
  'wine',
  'beer',
  'soup',
  'salad',
  'fish',
  'beef',
  'drumstick',
  'cookie',
  'croissant',
  'candy',
  'cup-soda',
  'sandwich',
  'egg',
  'apple',
  'banana',
  'carrot',
  'cherry',
  'grape',
  'wheat',
  'milk',
  'donut',
  'popcorn',
  'chef-hat',
  // health & beauty
  'heart-pulse',
  'stethoscope',
  'pill',
  'syringe',
  'cross',
  'brain',
  'bone',
  'eye',
  'sparkles',
  'scissors',
  'brush',
  // shopping
  'shopping-bag',
  'shopping-cart',
  'shopping-basket',
  'store',
  'tag',
  'receipt',
  'credit-card',
  'wallet',
  'gift',
  'package',
  'percent',
  // services
  'wrench',
  'hammer',
  'screwdriver',
  'plug',
  'zap',
  'settings',
  'paintbrush',
  // education
  'graduation-cap',
  'book',
  'book-open',
  'library',
  'pencil',
  'pen-tool',
  'lightbulb',
  'school',
  'notebook',
  // entertainment
  'gamepad-2',
  'film',
  'music',
  'mic',
  'ticket',
  'headphones',
  'drama',
  // travel & automotive
  'plane',
  'car',
  'bus',
  'train',
  'ship',
  'bike',
  'map-pin',
  'compass',
  'luggage',
  'mountain',
  'fuel',
  'gauge',
  'tent',
  // home
  'home',
  'sofa',
  'lamp',
  'bed',
  'bath',
  'refrigerator',
  'tv',
  'air-vent',
  // sports
  'dumbbell',
  'trophy',
  'target',
  'activity',
  'bicycle',
  // pets
  'paw-print',
  'cat',
  'dog',
  'bird',
  'rabbit',
  // art
  'palette',
  'image',
  'camera',
  'flower',
] as const;
export const categoryIconSchema = z.enum(CATEGORY_ICONS);

export const CATEGORY_ACCENTS = [
  'accent-1',
  'accent-2',
  'accent-3',
  'accent-4',
  'accent-5',
  'accent-6',
  'accent-7',
  'accent-8',
] as const;
export const categoryAccentSchema = z.enum(CATEGORY_ACCENTS);

export const categoryKindSchema = z.enum(['menu', 'services', 'none']);

/** Inferred value types for the category enums (used by the api repository). */
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];
export type CategoryAccent = (typeof CATEGORY_ACCENTS)[number];
export type CategoryKind = 'menu' | 'services' | 'none';

/** Localized text where `fa` is NOT required (category descriptions). */
export const localizedTextOptionalSchema = z.record(
  z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  z.string(),
);

export const categorySchema = z
  .object({
    id: uuidSchema,
    parentId: uuidSchema.nullable(),
    slug: slugSchema,
    name: localizedTextSchema,
    description: localizedTextOptionalSchema.nullable(),
    icon: categoryIconSchema,
    color: categoryAccentSchema.nullable(),
    kind: categoryKindSchema,
    supportsReservation: z.boolean(),
    isActive: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type Category = z.infer<typeof categorySchema>;

/** Public leaf (depth-2 child): no admin fields, no children. */
export const publicCategoryLeafSchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    name: localizedTextSchema,
    description: localizedTextOptionalSchema.nullable(),
    icon: categoryIconSchema,
    color: categoryAccentSchema.nullable(),
    kind: categoryKindSchema,
    supportsReservation: z.boolean(),
  })
  .strict();
/** Public node (depth-1 root): a leaf plus its active children. */
export const publicCategoryNodeSchema = publicCategoryLeafSchema.extend({
  children: z.array(publicCategoryLeafSchema),
});
export type PublicCategoryNode = z.infer<typeof publicCategoryNodeSchema>;
export type PublicCategoryLeaf = z.infer<typeof publicCategoryLeafSchema>;

export const createCategoryBodySchema = z
  .object({
    parentId: uuidSchema.nullable().optional(),
    slug: slugSchema.optional(),
    name: localizedTextSchema,
    description: localizedTextOptionalSchema.nullable().optional(),
    icon: categoryIconSchema,
    color: categoryAccentSchema.nullable().optional(),
    kind: categoryKindSchema.optional(),
    supportsReservation: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = z
  .object({
    parentId: uuidSchema.nullable().optional(),
    slug: slugSchema.optional(),
    name: localizedTextSchema.optional(),
    description: localizedTextOptionalSchema.nullable().optional(),
    icon: categoryIconSchema.optional(),
    color: categoryAccentSchema.nullable().optional(),
    kind: categoryKindSchema.optional(),
    supportsReservation: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

export const reorderCategoriesBodySchema = z
  .object({
    parentId: uuidSchema.nullable(),
    ids: z.array(uuidSchema).min(1).max(500),
  })
  .strict();
export type ReorderCategoriesBody = z.infer<typeof reorderCategoriesBodySchema>;

/** Admin category list item: flat, with child + business counts. */
export const adminCategorySchema = categorySchema.extend({
  childCount: z.number().int().min(0),
  businessCount: z.number().int().min(0),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

// ─── Amenities (B2.3) ────────────────────────────────────────────────────
// Features such as Wi-Fi, parking, outdoor seating. Flat catalog (no tree) +
// a many-to-many mapping to categories (`category_amenities`). A category
// inherits its parent's amenities in the public endpoint.

/** Lucide icon names for amenities (≥30). Overlaps CATEGORY_ICONS by design
 * (a coffee amenity uses the same icon as a cafe category); amenity-specific
 * icons (wifi, parking, accessibility, baby, snowflake, …) are added here. */
export const AMENITY_ICONS = [
  'wifi',
  'plug',
  'parking-square',
  'car',
  'bus',
  'bike',
  'accessibility',
  'baby',
  'stroller',
  'dog',
  'cat',
  'snowflake',
  'wind',
  'sun',
  'umbrella',
  'tree-pine',
  'trees',
  'utensils',
  'coffee',
  'wine',
  'beer',
  'pizza',
  'music',
  'volume-2',
  'headphones',
  'tv',
  'microwave',
  'refrigerator',
  'washing-machine',
  'sofa',
  'lamp',
  'credit-card',
  'wallet',
  'banknote',
  'receipt',
  'air-vent',
  'fan',
  'shower-head',
  'bath',
  'no-smoking',
] as const;
export const amenityIconSchema = z.enum(AMENITY_ICONS);
export type AmenityIcon = (typeof AMENITY_ICONS)[number];

export const AMENITY_GROUPS = [
  'general',
  'food',
  'payment',
  'accessibility',
  'family',
  'comfort',
] as const;
export const amenityGroupSchema = z.enum(AMENITY_GROUPS);
export type AmenityGroup = (typeof AMENITY_GROUPS)[number];

export const amenitySchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    name: localizedTextSchema,
    icon: amenityIconSchema,
    group: amenityGroupSchema,
    isActive: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type Amenity = z.infer<typeof amenitySchema>;

export const createAmenityBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedTextSchema,
    icon: amenityIconSchema,
    group: amenityGroupSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();
export type CreateAmenityBody = z.infer<typeof createAmenityBodySchema>;

export const updateAmenityBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedTextSchema.optional(),
    icon: amenityIconSchema.optional(),
    group: amenityGroupSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict();
export type UpdateAmenityBody = z.infer<typeof updateAmenityBodySchema>;

export const setCategoryAmenitiesBodySchema = z
  .object({ amenityIds: z.array(uuidSchema).min(0).max(100) })
  .strict();
export type SetCategoryAmenitiesBody = z.infer<typeof setCategoryAmenitiesBodySchema>;
