import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AmenityGroup, AmenityIcon } from '@app/contracts';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { amenities, categoryAmenities, categories } from '../../../db/schema/catalog.js';

/** DI token for the amenities repository (tests bind a fake). */
export const AMENITIES_REPOSITORY = Symbol('AMENITIES_REPOSITORY');

export interface AmenityView {
  id: string;
  slug: string;
  name: Record<string, string>;
  icon: AmenityIcon;
  group: AmenityGroup;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateAmenityInput {
  slug: string;
  name: Record<string, string>;
  icon: AmenityIcon;
  group: AmenityGroup;
  isActive: boolean;
  sortOrder: number;
}
export type UpdateAmenityInput = Partial<CreateAmenityInput>;

/** A mapped amenity carries its mapping sort_order (separate from the
 * amenity's own sort_order) for the public endpoint ordering. */
export interface MappedAmenityView extends AmenityView {
  mappingSortOrder: number;
}

export interface AmenitiesRepositoryLike {
  listActive(): Promise<AmenityView[]>;
  /** Active amenities mapped to the category and (if it is a child) its
   * parent, de-duplicated (the child's mapping wins), ordered by mapping
   * sort_order then group then amenity id. */
  listActiveForCategory(
    categoryId: string,
    parentCategoryId: string | null,
  ): Promise<MappedAmenityView[]>;
  listAll(): Promise<AmenityView[]>;
  findById(id: string): Promise<AmenityView | null>;
  findBySlug(slug: string): Promise<AmenityView | null>;
  slugExists(slug: string, exceptId?: string): Promise<boolean>;
  create(input: CreateAmenityInput): Promise<AmenityView>;
  update(id: string, input: UpdateAmenityInput): Promise<AmenityView | null>;
  delete(id: string): Promise<void>;
  /** The amenity ids mapped to a category (admin view), in mapping order. */
  getCategoryAmenityIds(categoryId: string): Promise<string[]>;
  /** Replace the category's mapping with the given amenity ids (sort_order by
   * position). Returns the new mapped amenities. */
  replaceCategoryAmenities(categoryId: string, amenityIds: string[]): Promise<MappedAmenityView[]>;
  /** Resolve a category slug to { id, parentId } (active only). */
  resolveCategory(slug: string): Promise<{ id: string; parentId: string | null } | null>;
}

interface AmenitySelectRow {
  readonly id: string;
  readonly slug: string;
  readonly name: Record<string, string>;
  readonly icon: string;
  readonly group: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

function rowToView(r: AmenitySelectRow): AmenityView {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    icon: r.icon as AmenityIcon,
    group: r.group as AmenityGroup,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}

const SELECT = {
  id: amenities.id,
  slug: amenities.slug,
  name: amenities.name,
  icon: amenities.icon,
  group: amenities.group,
  isActive: amenities.isActive,
  sortOrder: amenities.sortOrder,
} as const;

@Injectable()
export class AmenitiesRepository implements AmenitiesRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async listActive(): Promise<AmenityView[]> {
    const rows = await this.client.db
      .select(SELECT)
      .from(amenities)
      .where(eq(amenities.isActive, true))
      .orderBy(
        asc(amenities.sortOrder),
        asc(amenities.group),
        asc(sql`${amenities.name}->>'fa'`),
        asc(amenities.id),
      );
    return rows.map(rowToView);
  }

  async listActiveForCategory(
    categoryId: string,
    parentCategoryId: string | null,
  ): Promise<MappedAmenityView[]> {
    // Fetch mapping rows for the category and (optionally) its parent, child
    // first so it wins de-duplication. Then load the active amenities by id.
    const catIds = parentCategoryId ? [categoryId, parentCategoryId] : [categoryId];
    const mappings = await this.client.db
      .select({
        categoryId: categoryAmenities.categoryId,
        amenityId: categoryAmenities.amenityId,
        sortOrder: categoryAmenities.sortOrder,
      })
      .from(categoryAmenities)
      .where(inArray(categoryAmenities.categoryId, catIds))
      .orderBy(asc(categoryAmenities.sortOrder), asc(categoryAmenities.amenityId));
    // De-duplicate by amenityId, keeping the first occurrence (child category
    // mappings come first because categoryId === parentCategoryId only when
    // there is no parent; when there is, child rows are interleaved by sort
    // order — re-sort so child mappings win).
    const seen = new Map<string, { amenityId: string; sortOrder: number; fromChild: boolean }>();
    for (const m of mappings) {
      const fromChild = m.categoryId === categoryId;
      const existing = seen.get(m.amenityId);
      if (!existing || (fromChild && !existing.fromChild)) {
        seen.set(m.amenityId, { amenityId: m.amenityId, sortOrder: m.sortOrder, fromChild });
      }
    }
    const ids = [...seen.keys()];
    if (ids.length === 0) return [];
    const rows = await this.client.db
      .select(SELECT)
      .from(amenities)
      .where(and(eq(amenities.isActive, true), inArray(amenities.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, rowToView(r)]));
    // Order by mapping sort_order, then group, then amenity id (stable).
    return [...seen.values()]
      .map((m) => ({ ...(byId.get(m.amenityId) as AmenityView), mappingSortOrder: m.sortOrder }))
      .filter((v) => v.id)
      .sort(
        (a, b) =>
          a.mappingSortOrder - b.mappingSortOrder ||
          a.group.localeCompare(b.group) ||
          a.id.localeCompare(b.id),
      );
  }

  async listAll(): Promise<AmenityView[]> {
    const rows = await this.client.db
      .select(SELECT)
      .from(amenities)
      .orderBy(
        asc(amenities.sortOrder),
        asc(amenities.group),
        asc(sql`${amenities.name}->>'fa'`),
        asc(amenities.id),
      );
    return rows.map(rowToView);
  }

  async findById(id: string): Promise<AmenityView | null> {
    const rows = await this.client.db
      .select(SELECT)
      .from(amenities)
      .where(eq(amenities.id, id))
      .limit(1);
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<AmenityView | null> {
    const rows = await this.client.db
      .select(SELECT)
      .from(amenities)
      .where(eq(amenities.slug, slug))
      .limit(1);
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async slugExists(slug: string, exceptId?: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: amenities.id })
      .from(amenities)
      .where(
        exceptId
          ? and(eq(amenities.slug, slug), sql`${amenities.id} <> ${exceptId}`)
          : eq(amenities.slug, slug),
      )
      .limit(1);
    return rows.length > 0;
  }

  async create(input: CreateAmenityInput): Promise<AmenityView> {
    const rows = await this.client.db
      .insert(amenities)
      .values({
        slug: input.slug,
        name: input.name,
        icon: input.icon,
        group: input.group,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('amenities insert returned no row');
    return rowToView(row);
  }

  async update(id: string, input: UpdateAmenityInput): Promise<AmenityView | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = input.name;
    if (input.icon !== undefined) set.icon = input.icon;
    if (input.group !== undefined) set.group = input.group;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    const rows = await this.client.db
      .update(amenities)
      .set(set)
      .where(eq(amenities.id, id))
      .returning();
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    // category_amenities rows cascade-delete.
    await this.client.db.delete(amenities).where(eq(amenities.id, id));
  }

  async getCategoryAmenityIds(categoryId: string): Promise<string[]> {
    const rows = await this.client.db
      .select({ amenityId: categoryAmenities.amenityId })
      .from(categoryAmenities)
      .where(eq(categoryAmenities.categoryId, categoryId))
      .orderBy(asc(categoryAmenities.sortOrder), asc(categoryAmenities.amenityId));
    return rows.map((r) => r.amenityId);
  }

  async replaceCategoryAmenities(
    categoryId: string,
    amenityIds: string[],
  ): Promise<MappedAmenityView[]> {
    await this.client.db.transaction(async (tx) => {
      await tx.delete(categoryAmenities).where(eq(categoryAmenities.categoryId, categoryId));
      let i = 0;
      for (const aid of amenityIds) {
        await tx.insert(categoryAmenities).values({ categoryId, amenityId: aid, sortOrder: i });
        i++;
      }
    });
    return this.listActiveForCategory(categoryId, null);
  }

  async resolveCategory(slug: string): Promise<{ id: string; parentId: string | null } | null> {
    const rows = await this.client.db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .limit(1);
    const r = rows[0];
    return r ? { id: r.id, parentId: r.parentId } : null;
  }
}
