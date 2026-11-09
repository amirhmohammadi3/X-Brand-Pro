import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businessAmenities, businessCategories, businesses } from '../../db/schema/business.js';
import { categories, amenities } from '../../db/schema/catalog.js';
import { cities, neighborhoods } from '../../db/schema/geo.js';
import { mediaFiles } from '../../db/schema/media.js';
// MediaUrlService is constructor-injected: Nest reads its type at runtime via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MediaUrlService } from '../media/media-url.service.js';
import type {
  BusinessAmenityRef,
  BusinessCategoryRef,
  BusinessDetail,
  BusinessSource,
  BusinessStatus,
  BusinessSummary,
  Bbox,
  GeoPoint,
} from '@app/contracts';

/** DI token for the businesses repository (tests bind a fake). */
export const BUSINESSES_REPOSITORY = Symbol('BUSINESSES_REPOSITORY');

/** The full create payload — the repository writes businesses + both join
 * tables in one transaction. `categoryIds` MUST include `primaryCategoryId`;
 * the repository guarantees exactly one primary category row. */
export interface CreateBusinessInput {
  slug: string;
  name: string;
  /** B3.1: Persian-normalized name (normalizePersianText) for trigram search. */
  nameNormalized?: string | null;
  nameAlt?: string | null;
  description?: string | null;
  cityId: string;
  neighborhoodId?: string | null;
  primaryCategoryId: string;
  address: string;
  location: GeoPoint;
  priceLevel?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  instagram?: string | null;
  website?: string | null;
  email?: string | null;
  status?: BusinessStatus;
  ownerId?: string | null;
  createdBy?: string | null;
  isClaimed?: boolean;
  isFeatured?: boolean;
  isDemo?: boolean;
  coverMediaId?: string | null;
  tags?: string[];
  source?: BusinessSource;
  publishedAt?: Date | null;
  rejectionReason?: string | null;
  categoryIds: string[];
  amenityIds: string[];
}

/** Partial scalar update — join tables are touched via replace* methods. */
export type UpdateBusinessInput = Partial<Omit<CreateBusinessInput, 'categoryIds' | 'amenityIds'>>;

/**
 * The city fields B2.6 needs to validate a business registration: the bbox for
 * the location-in-bbox rule and the localized name (slug fallback) for slug
 * derivation. `isActive` lets the service refuse filing under a hidden city.
 */
export interface CityForBusiness {
  id: string;
  slug: string;
  name: Record<string, string>;
  bbox: Bbox | null;
  isActive: boolean;
}

/** The narrow fake-able surface consumed by the service + B2.6's HTTP layer. */
export interface BusinessesRepositoryLike {
  existsSlug(slug: string, exceptId?: string): Promise<boolean>;
  findById(id: string): Promise<BusinessDetail | null>;
  findBySlug(slug: string): Promise<BusinessDetail | null>;
  insert(input: CreateBusinessInput): Promise<BusinessDetail>;
  update(id: string, input: UpdateBusinessInput): Promise<BusinessDetail | null>;
  replaceCategories(
    businessId: string,
    categoryIds: string[],
    primaryCategoryId: string,
  ): Promise<void>;
  replaceAmenities(businessId: string, amenityIds: string[]): Promise<void>;
  setStatus(id: string, status: BusinessStatus, publishedAt?: Date | null): Promise<void>;
  softDelete(id: string): Promise<void>;
  listByOwner(ownerId: string): Promise<BusinessSummary[]>;
  /* --- B2.6 existence/bbox lookups (the service validates create/update input).
   * These query the already-joined cities/neighborhoods/categories/amenities
   * tables directly so the business module stays self-contained (no circular
   * import of the geo/catalog modules, which import BusinessModule for their
   * counters). */
  findCityForBusiness(cityId: string): Promise<CityForBusiness | null>;
  /** True iff the neighborhood exists, is active and belongs to `cityId`. */
  findNeighborhoodInCity(neighborhoodId: string, cityId: string): Promise<boolean>;
  /** The subset of `categoryIds` that exist and are active (assignable). */
  categoriesExistAndActive(categoryIds: string[]): Promise<string[]>;
  /** The subset of `amenityIds` that exist and are active. */
  amenitiesExistAndActive(amenityIds: string[]): Promise<string[]>;
}

// ─── PostGIS point helpers (mirror geo.repository) ────────────────────────
function pointValue(p: GeoPoint) {
  return sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
}
const latExpr = sql`ST_Y(${businesses.location}::geometry)::double precision`.as('lat');
const lngExpr = sql`ST_X(${businesses.location}::geometry)::double precision`.as('lng');

/** Joined summary row: businesses + city + primary category + optional
 * neighborhood + optional cover media. `lat`/`lng` are read out of the
 * geography column; `avgRating` is numeric(3,2) → string until mapped. */
const SUMMARY_SELECT = {
  id: businesses.id,
  slug: businesses.slug,
  name: businesses.name,
  nameAlt: businesses.nameAlt,
  description: businesses.description,
  cityId: businesses.cityId,
  neighborhoodId: businesses.neighborhoodId,
  primaryCategoryId: businesses.primaryCategoryId,
  address: businesses.address,
  lat: latExpr,
  lng: lngExpr,
  priceLevel: businesses.priceLevel,
  phone: businesses.phone,
  whatsapp: businesses.whatsapp,
  telegram: businesses.telegram,
  instagram: businesses.instagram,
  website: businesses.website,
  email: businesses.email,
  status: businesses.status,
  ownerId: businesses.ownerId,
  isClaimed: businesses.isClaimed,
  isFeatured: businesses.isFeatured,
  avgRating: businesses.avgRating,
  reviewCount: businesses.reviewCount,
  tags: businesses.tags,
  source: businesses.source,
  rejectionReason: businesses.rejectionReason,
  publishedAt: businesses.publishedAt,
  createdAt: businesses.createdAt,
  updatedAt: businesses.updatedAt,
  coverMediaKey: mediaFiles.key,
  coverMediaThumbKey: mediaFiles.thumbKey,
  cityName: cities.name,
  citySlug: cities.slug,
  cityRowId: cities.id,
  neighborhoodRowId: neighborhoods.id,
  neighborhoodSlug: neighborhoods.slug,
  neighborhoodName: neighborhoods.name,
  primaryCategoryRowId: categories.id,
  primaryCategorySlug: categories.slug,
  primaryCategoryName: categories.name,
} as const;

interface SummaryRow {
  id: string;
  slug: string;
  name: string;
  nameAlt: string | null;
  description: string | null;
  cityId: string;
  neighborhoodId: string | null;
  primaryCategoryId: string;
  address: string;
  lat: unknown;
  lng: unknown;
  priceLevel: number | null;
  phone: string | null;
  whatsapp: string | null;
  telegram: string | null;
  instagram: string | null;
  website: string | null;
  email: string | null;
  status: BusinessStatus;
  ownerId: string | null;
  isClaimed: boolean;
  isFeatured: boolean;
  avgRating: string;
  reviewCount: number;
  tags: string[];
  source: BusinessSource;
  rejectionReason: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  coverMediaKey: string | null;
  coverMediaThumbKey: string | null;
  cityName: Record<string, string>;
  citySlug: string;
  cityRowId: string;
  neighborhoodRowId: string | null;
  neighborhoodSlug: string | null;
  neighborhoodName: Record<string, string> | null;
  primaryCategoryRowId: string;
  primaryCategorySlug: string;
  primaryCategoryName: Record<string, string>;
}

@Injectable()
export class BusinessesRepository implements BusinessesRepositoryLike {
  constructor(
    @Inject(DrizzleClient) private readonly client: DrizzleClient,
    private readonly mediaUrl: MediaUrlService,
  ) {}

  async existsSlug(slug: string, exceptId?: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: businesses.id })
      .from(businesses)
      .where(
        exceptId
          ? and(eq(businesses.slug, slug), sql`${businesses.id} <> ${exceptId}`)
          : eq(businesses.slug, slug),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listByOwner(ownerId: string): Promise<BusinessSummary[]> {
    const rows = await this.client.db
      .select(SUMMARY_SELECT)
      .from(businesses)
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .innerJoin(categories, eq(categories.id, businesses.primaryCategoryId))
      .leftJoin(neighborhoods, eq(neighborhoods.id, businesses.neighborhoodId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, businesses.coverMediaId))
      .where(and(eq(businesses.ownerId, ownerId), isNull(businesses.deletedAt)))
      .orderBy(desc(businesses.createdAt), asc(businesses.id));
    return (rows as unknown as SummaryRow[]).map((r) => this.toSummary(r));
  }

  async findById(id: string): Promise<BusinessDetail | null> {
    return this.fetchDetail(eq(businesses.id, id));
  }

  async findBySlug(slug: string): Promise<BusinessDetail | null> {
    return this.fetchDetail(eq(businesses.slug, slug));
  }

  async insert(input: CreateBusinessInput): Promise<BusinessDetail> {
    const id = await this.client.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(businesses)
        .values({
          slug: input.slug,
          name: input.name,
          nameNormalized: input.nameNormalized ?? null,
          nameAlt: input.nameAlt ?? null,
          description: input.description ?? null,
          cityId: input.cityId,
          neighborhoodId: input.neighborhoodId ?? null,
          primaryCategoryId: input.primaryCategoryId,
          address: input.address,
          location: pointValue(input.location),
          priceLevel: input.priceLevel ?? null,
          phone: input.phone ?? null,
          whatsapp: input.whatsapp ?? null,
          telegram: input.telegram ?? null,
          instagram: input.instagram ?? null,
          website: input.website ?? null,
          email: input.email ?? null,
          status: input.status ?? 'pending',
          ownerId: input.ownerId ?? null,
          createdBy: input.createdBy ?? null,
          isClaimed: input.isClaimed ?? false,
          isFeatured: input.isFeatured ?? false,
          isDemo: input.isDemo ?? false,
          coverMediaId: input.coverMediaId ?? null,
          tags: input.tags ?? [],
          source: input.source ?? 'manual',
          publishedAt: input.publishedAt ?? null,
        })
        .returning({ id: businesses.id });
      const bid = inserted[0]?.id;
      if (!bid) throw new Error('businesses insert returned no row');

      // Guarantee exactly one primary category: merge primaryCategoryId into
      // the set, mark it is_primary; every other category row stays secondary.
      const allCategoryIds = Array.from(new Set([...input.categoryIds, input.primaryCategoryId]));
      if (allCategoryIds.length > 0) {
        await tx.insert(businessCategories).values(
          allCategoryIds.map((categoryId) => ({
            businessId: bid,
            categoryId,
            isPrimary: categoryId === input.primaryCategoryId,
          })),
        );
      }
      if (input.amenityIds.length > 0) {
        await tx
          .insert(businessAmenities)
          .values(input.amenityIds.map((amenityId) => ({ businessId: bid, amenityId })));
      }
      return bid;
    });
    const detail = await this.findById(id);
    if (!detail) throw new Error('business insert returned no row');
    return detail;
  }

  async update(id: string, input: UpdateBusinessInput): Promise<BusinessDetail | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = input.name;
    if (input.nameNormalized !== undefined) set.nameNormalized = input.nameNormalized;
    if (input.nameAlt !== undefined) set.nameAlt = input.nameAlt;
    if (input.description !== undefined) set.description = input.description;
    if (input.cityId !== undefined) set.cityId = input.cityId;
    if (input.neighborhoodId !== undefined) set.neighborhoodId = input.neighborhoodId;
    if (input.primaryCategoryId !== undefined) set.primaryCategoryId = input.primaryCategoryId;
    if (input.address !== undefined) set.address = input.address;
    if (input.location !== undefined) set.location = pointValue(input.location);
    if (input.priceLevel !== undefined) set.priceLevel = input.priceLevel;
    if (input.phone !== undefined) set.phone = input.phone;
    if (input.whatsapp !== undefined) set.whatsapp = input.whatsapp;
    if (input.telegram !== undefined) set.telegram = input.telegram;
    if (input.instagram !== undefined) set.instagram = input.instagram;
    if (input.website !== undefined) set.website = input.website;
    if (input.email !== undefined) set.email = input.email;
    if (input.status !== undefined) set.status = input.status;
    if (input.ownerId !== undefined) set.ownerId = input.ownerId;
    if (input.createdBy !== undefined) set.createdBy = input.createdBy;
    if (input.isClaimed !== undefined) set.isClaimed = input.isClaimed;
    if (input.isFeatured !== undefined) set.isFeatured = input.isFeatured;
    if (input.isDemo !== undefined) set.isDemo = input.isDemo;
    if (input.coverMediaId !== undefined) set.coverMediaId = input.coverMediaId;
    if (input.tags !== undefined) set.tags = input.tags;
    if (input.source !== undefined) set.source = input.source;
    if (input.rejectionReason !== undefined) set.rejectionReason = input.rejectionReason;
    if (input.publishedAt !== undefined) set.publishedAt = input.publishedAt;
    await this.client.db.update(businesses).set(set).where(eq(businesses.id, id));
    return this.findById(id);
  }

  async replaceCategories(
    businessId: string,
    categoryIds: string[],
    primaryCategoryId: string,
  ): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      await tx.delete(businessCategories).where(eq(businessCategories.businessId, businessId));
      const allCategoryIds = Array.from(new Set([...categoryIds, primaryCategoryId]));
      if (allCategoryIds.length > 0) {
        await tx.insert(businessCategories).values(
          allCategoryIds.map((categoryId) => ({
            businessId,
            categoryId,
            isPrimary: categoryId === primaryCategoryId,
          })),
        );
      }
    });
  }

  async replaceAmenities(businessId: string, amenityIds: string[]): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      await tx.delete(businessAmenities).where(eq(businessAmenities.businessId, businessId));
      if (amenityIds.length > 0) {
        await tx
          .insert(businessAmenities)
          .values(amenityIds.map((amenityId) => ({ businessId, amenityId })));
      }
    });
  }

  /** Sets the status; going `active` stamps `published_at = now()` when the
   * caller did not pass one (the CHECK constraint requires it). */
  async setStatus(id: string, status: BusinessStatus, publishedAt?: Date | null): Promise<void> {
    const stamp = status === 'active' && publishedAt === undefined ? new Date() : publishedAt;
    const set: Record<string, unknown> = { status, updatedAt: new Date() };
    if (stamp !== undefined) set.publishedAt = stamp;
    await this.client.db.update(businesses).set(set).where(eq(businesses.id, id));
  }

  async softDelete(id: string): Promise<void> {
    await this.client.db
      .update(businesses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(businesses.id, id));
  }

  // ─── B2.6 existence/bbox lookups ────────────────────────────────────────

  async findCityForBusiness(cityId: string): Promise<CityForBusiness | null> {
    const rows = await this.client.db
      .select({
        id: cities.id,
        slug: cities.slug,
        name: cities.name,
        bbox: cities.bbox,
        isActive: cities.isActive,
      })
      .from(cities)
      .where(eq(cities.id, cityId))
      .limit(1);
    const r = rows[0];
    return r ? { id: r.id, slug: r.slug, name: r.name, bbox: r.bbox, isActive: r.isActive } : null;
  }

  async findNeighborhoodInCity(neighborhoodId: string, cityId: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: neighborhoods.id })
      .from(neighborhoods)
      .where(
        and(
          eq(neighborhoods.id, neighborhoodId),
          eq(neighborhoods.cityId, cityId),
          eq(neighborhoods.isActive, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async categoriesExistAndActive(categoryIds: string[]): Promise<string[]> {
    if (categoryIds.length === 0) return [];
    const unique = Array.from(new Set(categoryIds));
    const rows = await this.client.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(sql`${categories.id} = any(${unique})`, eq(categories.isActive, true)));
    return rows.map((r) => r.id);
  }

  async amenitiesExistAndActive(amenityIds: string[]): Promise<string[]> {
    if (amenityIds.length === 0) return [];
    const unique = Array.from(new Set(amenityIds));
    const rows = await this.client.db
      .select({ id: amenities.id })
      .from(amenities)
      .where(and(sql`${amenities.id} = any(${unique})`, eq(amenities.isActive, true)));
    return rows.map((r) => r.id);
  }

  // ─── private helpers ────────────────────────────────────────────────────

  private async fetchDetail(where: unknown): Promise<BusinessDetail | null> {
    const rows = await this.client.db
      .select(SUMMARY_SELECT)
      .from(businesses)
      .innerJoin(cities, eq(cities.id, businesses.cityId))
      .innerJoin(categories, eq(categories.id, businesses.primaryCategoryId))
      .leftJoin(neighborhoods, eq(neighborhoods.id, businesses.neighborhoodId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, businesses.coverMediaId))
      .where(where as never)
      .limit(1);
    const row = rows[0] as SummaryRow | undefined;
    if (!row) return null;
    const [cats, amens] = await Promise.all([
      this.fetchCategoryRefs(row.id),
      this.fetchAmenityRefs(row.id),
    ]);
    return this.toDetail(row, cats, amens);
  }

  private async fetchCategoryRefs(businessId: string): Promise<BusinessCategoryRef[]> {
    const rows = await this.client.db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        isPrimary: businessCategories.isPrimary,
      })
      .from(businessCategories)
      .innerJoin(categories, eq(categories.id, businessCategories.categoryId))
      .where(eq(businessCategories.businessId, businessId))
      .orderBy(asc(businessCategories.createdAt), asc(categories.id));
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, isPrimary: r.isPrimary }));
  }

  private async fetchAmenityRefs(businessId: string): Promise<BusinessAmenityRef[]> {
    const rows = await this.client.db
      .select({
        id: amenities.id,
        slug: amenities.slug,
        name: amenities.name,
        icon: amenities.icon,
      })
      .from(businessAmenities)
      .innerJoin(amenities, eq(amenities.id, businessAmenities.amenityId))
      .where(eq(businessAmenities.businessId, businessId))
      .orderBy(asc(businessAmenities.createdAt), asc(amenities.id));
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, icon: r.icon }));
  }

  private toSummary(r: SummaryRow): BusinessSummary {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      nameAlt: r.nameAlt,
      primaryCategory: {
        id: r.primaryCategoryRowId,
        slug: r.primaryCategorySlug,
        name: r.primaryCategoryName,
      },
      city: { id: r.cityRowId, slug: r.citySlug, name: r.cityName },
      neighborhood: r.neighborhoodRowId
        ? {
            id: r.neighborhoodRowId,
            slug: r.neighborhoodSlug as string,
            name: r.neighborhoodName as Record<string, string>,
          }
        : null,
      address: r.address,
      location: { lat: Number(r.lat), lng: Number(r.lng) },
      priceLevel: r.priceLevel,
      avgRating: Number(r.avgRating),
      reviewCount: r.reviewCount,
      coverUrl: this.mediaUrl.urlFor(r.coverMediaKey),
      thumbUrl: this.mediaUrl.urlFor(r.coverMediaThumbKey),
      isFeatured: r.isFeatured,
      isClaimed: r.isClaimed,
    };
  }

  private toDetail(
    r: SummaryRow,
    categoriesList: BusinessCategoryRef[],
    amenitiesList: BusinessAmenityRef[],
  ): BusinessDetail {
    return {
      ...this.toSummary(r),
      ownerId: r.ownerId,
      description: r.description,
      phone: r.phone,
      whatsapp: r.whatsapp,
      telegram: r.telegram,
      instagram: r.instagram,
      website: r.website,
      email: r.email,
      amenities: amenitiesList,
      categories: categoriesList,
      tags: r.tags,
      status: r.status,
      source: r.source,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
