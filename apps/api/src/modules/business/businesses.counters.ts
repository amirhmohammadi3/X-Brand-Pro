import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { businessAmenities, businessCategories } from '../../db/schema/business.js';
import type { AmenityUsageCounter } from '../catalog/amenities/amenities.service.js';
import type { CategoryBusinessCounter } from '../catalog/categories/categories.service.js';
import type { BusinessCounter } from '../geo/geo.service.js';

/**
 * Real implementations of the three counter providers the catalog/geo modules
 * expected (B2.1–B2.3 registered stubs returning 0). B2.4 binds this class to
 * all three tokens; the delete guards in cities/categories/amenities now refuse
 * when a non-soft-deleted business is actually linked.
 *
 * Counts exclude soft-deleted businesses (`deleted_at is null`) so retiring a
 * business does not keep a catalog row locked. `countByCategory`/`countByAmenity`
 * count distinct businesses across the join tables (a business linked twice to
 * the same category is still one business).
 */
@Injectable()
export class BusinessCounters
  implements BusinessCounter, CategoryBusinessCounter, AmenityUsageCounter
{
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async countByCity(cityId: string): Promise<number> {
    const rows = await this.client.db
      .select({ count: sql<number>`count(*)::int` })
      .from(businesses)
      .where(and(eq(businesses.cityId, cityId), isNull(businesses.deletedAt)));
    return rows[0]?.count ?? 0;
  }

  async countByCategory(categoryId: string): Promise<number> {
    const rows = await this.client.db
      .select({ count: sql<number>`count(distinct ${businessCategories.businessId})::int` })
      .from(businessCategories)
      .innerJoin(businesses, eq(businesses.id, businessCategories.businessId))
      .where(and(eq(businessCategories.categoryId, categoryId), isNull(businesses.deletedAt)));
    return rows[0]?.count ?? 0;
  }

  async countByAmenity(amenityId: string): Promise<number> {
    const rows = await this.client.db
      .select({ count: sql<number>`count(distinct ${businessAmenities.businessId})::int` })
      .from(businessAmenities)
      .innerJoin(businesses, eq(businesses.id, businessAmenities.businessId))
      .where(and(eq(businessAmenities.amenityId, amenityId), isNull(businesses.deletedAt)));
    return rows[0]?.count ?? 0;
  }
}
