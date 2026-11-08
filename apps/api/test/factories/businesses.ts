import { sql } from 'drizzle-orm';
import type { DrizzleDb } from '../../src/db/drizzle.client.js';
import { cities, neighborhoods, categories } from '../../src/db/schema/index.js';
import {
  businessAmenities,
  businessCategories,
  businesses,
  type BusinessRow,
} from '../../src/db/schema/business.js';
import type { CityRow, NeighborhoodRow } from '../../src/db/schema/geo.js';
import type { CategoryRow } from '../../src/db/schema/catalog.js';
import type { GeoPoint } from '@app/contracts';

/**
 * Test factories (B2.4) for the business catalog — used by the DB-requiring
 * integration suites (round-trip, one-primary, delete protections, partial
 * index, check constraints). Each helper inserts the minimum valid row and
 * returns it; `createBusiness` auto-creates a city, a category and a
 * neighborhood when the caller does not supply their ids, so a test can spin
 * up a fully-valid business with a single call.
 */

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  // slugSchema allows a-z0-9 and Persian letters + hyphen; keep it ASCII-safe.
  return `${prefix}-${seq.toString(36).padStart(4, '0')}`;
}

function pointValue(p: GeoPoint) {
  return sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
}

const DEFAULT_CENTER: GeoPoint = { lat: 35.6892, lng: 51.389 };
const DEFAULT_BBOX = { west: 51.0, south: 35.55, east: 51.6, north: 35.85 };

export interface CreateCityOverrides {
  slug?: string;
  name?: Record<string, string>;
  center?: GeoPoint;
  bbox?: { west: number; south: number; east: number; north: number } | null;
  timezone?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export async function createCity(
  db: DrizzleDb,
  overrides: CreateCityOverrides = {},
): Promise<CityRow> {
  const rows = await db
    .insert(cities)
    .values({
      slug: overrides.slug ?? uniq('city'),
      name: overrides.name ?? { fa: 'تهران', en: 'Tehran' },
      center: pointValue(overrides.center ?? DEFAULT_CENTER),
      bbox: overrides.bbox ?? DEFAULT_BBOX,
      timezone: overrides.timezone ?? 'Asia/Tehran',
      isActive: overrides.isActive ?? true,
      sortOrder: overrides.sortOrder ?? 0,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function createNeighborhood(
  db: DrizzleDb,
  cityId: string,
  overrides: {
    slug?: string;
    name?: Record<string, string>;
    center?: GeoPoint;
    isActive?: boolean;
  } = {},
): Promise<NeighborhoodRow> {
  const rows = await db
    .insert(neighborhoods)
    .values({
      cityId,
      slug: overrides.slug ?? uniq('neigh'),
      name: overrides.name ?? { fa: 'ولیعصر', en: 'Valiasr' },
      center: pointValue(overrides.center ?? DEFAULT_CENTER),
      isActive: overrides.isActive ?? true,
      sortOrder: 0,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('insert returned no row');
  return row;
}

export interface CreateCategoryOverrides {
  slug?: string;
  name?: Record<string, string>;
  icon?: string;
  kind?: string;
  isActive?: boolean;
  parentId?: string | null;
}

export async function createCategory(
  db: DrizzleDb,
  overrides: CreateCategoryOverrides = {},
): Promise<CategoryRow> {
  const rows = await db
    .insert(categories)
    .values({
      parentId: overrides.parentId ?? null,
      slug: overrides.slug ?? uniq('cat'),
      name: overrides.name ?? { fa: 'کافه', en: 'Cafe' },
      icon: overrides.icon ?? 'coffee',
      kind: overrides.kind ?? 'none',
      isActive: overrides.isActive ?? true,
      sortOrder: 0,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('insert returned no row');
  return row;
}

export interface CreateBusinessOverrides {
  slug?: string;
  name?: string;
  nameAlt?: string | null;
  description?: string | null;
  cityId?: string;
  neighborhoodId?: string | null;
  primaryCategoryId?: string;
  address?: string;
  location?: GeoPoint;
  priceLevel?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  instagram?: string | null;
  website?: string | null;
  email?: string | null;
  status?: BusinessRow['status'];
  ownerId?: string | null;
  createdBy?: string | null;
  isClaimed?: boolean;
  isFeatured?: boolean;
  isDemo?: boolean;
  tags?: string[];
  source?: BusinessRow['source'];
  publishedAt?: Date | null;
  categoryIds?: string[];
  amenityIds?: string[];
}

/**
 * Insert a business (and its category/amenity joins). When `cityId`,
 * `primaryCategoryId` or `neighborhoodId` are missing, the factory creates a
 * valid city, category and neighborhood first. `categoryIds` defaults to
 * `[primaryCategoryId]` so the primary is always linked; pass more to add
 * secondary categories.
 */
export async function createBusiness(
  db: DrizzleDb,
  overrides: CreateBusinessOverrides = {},
): Promise<BusinessRow> {
  const cityId = overrides.cityId ?? (await createCity(db)).id;
  const primaryCategoryId = overrides.primaryCategoryId ?? (await createCategory(db)).id;
  const neighborhoodId =
    overrides.neighborhoodId === undefined
      ? (await createNeighborhood(db, cityId)).id
      : overrides.neighborhoodId;

  const status = overrides.status ?? 'pending';
  const publishedAt =
    overrides.publishedAt === undefined
      ? status === 'active'
        ? new Date()
        : null
      : overrides.publishedAt;

  const rows = await db
    .insert(businesses)
    .values({
      slug: overrides.slug ?? uniq('biz'),
      name: overrides.name ?? 'کافه رحیمی',
      nameAlt: overrides.nameAlt ?? null,
      description: overrides.description ?? null,
      cityId,
      neighborhoodId,
      primaryCategoryId,
      address: overrides.address ?? 'ولیعصر، پلاک ۱',
      location: pointValue(overrides.location ?? DEFAULT_CENTER),
      priceLevel: overrides.priceLevel ?? null,
      phone: overrides.phone ?? null,
      whatsapp: overrides.whatsapp ?? null,
      telegram: overrides.telegram ?? null,
      instagram: overrides.instagram ?? null,
      website: overrides.website ?? null,
      email: overrides.email ?? null,
      status,
      ownerId: overrides.ownerId ?? null,
      createdBy: overrides.createdBy ?? null,
      isClaimed: overrides.isClaimed ?? false,
      isFeatured: overrides.isFeatured ?? false,
      isDemo: overrides.isDemo ?? false,
      tags: overrides.tags ?? [],
      source: overrides.source ?? 'manual',
      publishedAt,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('business insert returned no row');
  const bid = row.id;

  const categoryIds = overrides.categoryIds ?? [primaryCategoryId];
  const allCategoryIds = Array.from(new Set([...categoryIds, primaryCategoryId]));
  if (allCategoryIds.length > 0) {
    await db.insert(businessCategories).values(
      allCategoryIds.map((categoryId) => ({
        businessId: bid,
        categoryId,
        isPrimary: categoryId === primaryCategoryId,
      })),
    );
  }
  if (overrides.amenityIds && overrides.amenityIds.length > 0) {
    await db
      .insert(businessAmenities)
      .values(overrides.amenityIds.map((amenityId) => ({ businessId: bid, amenityId })));
  }
  return row;
}
