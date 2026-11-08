import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CategoryAccent, CategoryIcon, CategoryKind } from '@app/contracts';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { categories } from '../../../db/schema/catalog.js';

/**
 * All Drizzle access for the categories domain (B2.2). The narrow surface
 * doubles as the fake-able contract for unit tests. The two-level tree is
 * assembled in memory from a single ordered query (roots have parent_id null).
 */

/** DI token for the categories repository (tests bind a fake). */
export const CATEGORIES_REPOSITORY = Symbol('CATEGORIES_REPOSITORY');

export interface CategoryView {
  id: string;
  parentId: string | null;
  slug: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  icon: CategoryIcon;
  color: CategoryAccent | null;
  kind: CategoryKind;
  supportsReservation: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** A root with its children attached (the public tree shape, internal view). */
export interface CategoryTreeNode extends CategoryView {
  children: CategoryView[];
}

export interface CreateCategoryInput {
  parentId: string | null;
  slug: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  icon: CategoryIcon;
  color: CategoryAccent | null;
  kind: CategoryKind;
  supportsReservation: boolean;
  isActive: boolean;
  sortOrder: number;
}
export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export interface CategoriesRepositoryLike {
  listActiveTree(): Promise<CategoryTreeNode[]>; // roots with their active children
  findActiveBySlug(slug: string): Promise<CategoryView | null>;
  listActiveChildren(parentId: string): Promise<CategoryView[]>;
  listAll(): Promise<CategoryView[]>;
  findById(id: string): Promise<CategoryView | null>;
  findBySlug(slug: string): Promise<CategoryView | null>;
  slugExists(slug: string, exceptId?: string): Promise<boolean>;
  hasChildren(id: string): Promise<boolean>;
  countChildrenByParent(): Promise<Map<string, number>>;
  create(input: CreateCategoryInput): Promise<CategoryView>;
  update(id: string, input: UpdateCategoryInput): Promise<CategoryView | null>;
  delete(id: string): Promise<void>;
  reorder(parentId: string | null, ids: string[]): Promise<void>;
}

/** The subset of a category row that rowToView reads (works for both the
 * SELECT projection and a full returning() row). */
interface CategoryViewRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly name: Record<string, string>;
  readonly description: Record<string, string> | null;
  readonly icon: string;
  readonly color: string | null;
  readonly kind: string;
  readonly supportsReservation: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

function rowToView(r: CategoryViewRow): CategoryView {
  return {
    id: r.id,
    parentId: r.parentId,
    slug: r.slug,
    name: r.name,
    description: r.description,
    icon: r.icon as CategoryIcon,
    color: r.color as CategoryAccent | null,
    kind: r.kind as CategoryKind,
    supportsReservation: r.supportsReservation,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}

const SELECT = {
  id: categories.id,
  parentId: categories.parentId,
  slug: categories.slug,
  name: categories.name,
  description: categories.description,
  icon: categories.icon,
  color: categories.color,
  kind: categories.kind,
  supportsReservation: categories.supportsReservation,
  isActive: categories.isActive,
  sortOrder: categories.sortOrder,
} as const;

@Injectable()
export class CategoriesRepository implements CategoriesRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async listActiveTree(): Promise<CategoryTreeNode[]> {
    const rows = await this.client.db
      .select(SELECT)
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(
        sql`${categories.parentId} IS NULL DESC`,
        asc(categories.sortOrder),
        asc(sql`${categories.name}->>'fa'`),
        asc(categories.id),
      );
    const childrenByParent = new Map<string, CategoryView[]>();
    for (const r of rows) {
      if (r.parentId) {
        const arr = childrenByParent.get(r.parentId) ?? [];
        arr.push(rowToView(r));
        childrenByParent.set(r.parentId, arr);
      }
    }
    return rows
      .filter((r) => r.parentId === null)
      .map((root) => ({ ...rowToView(root), children: childrenByParent.get(root.id) ?? [] }));
  }

  async findActiveBySlug(slug: string): Promise<CategoryView | null> {
    const rows = await this.client.db
      .select(SELECT)
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .limit(1);
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async listActiveChildren(parentId: string): Promise<CategoryView[]> {
    const rows = await this.client.db
      .select(SELECT)
      .from(categories)
      .where(and(eq(categories.parentId, parentId), eq(categories.isActive, true)))
      .orderBy(asc(categories.sortOrder), asc(sql`${categories.name}->>'fa'`), asc(categories.id));
    return rows.map(rowToView);
  }

  async listAll(): Promise<CategoryView[]> {
    const rows = await this.client.db
      .select(SELECT)
      .from(categories)
      .orderBy(
        sql`${categories.parentId} IS NULL DESC`,
        asc(categories.sortOrder),
        asc(sql`${categories.name}->>'fa'`),
        asc(categories.id),
      );
    return rows.map(rowToView);
  }

  async findById(id: string): Promise<CategoryView | null> {
    const rows = await this.client.db
      .select(SELECT)
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<CategoryView | null> {
    const rows = await this.client.db
      .select(SELECT)
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async slugExists(slug: string, exceptId?: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: categories.id })
      .from(categories)
      .where(
        exceptId
          ? and(eq(categories.slug, slug), sql`${categories.id} <> ${exceptId}`)
          : eq(categories.slug, slug),
      )
      .limit(1);
    return rows.length > 0;
  }

  async hasChildren(id: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, id))
      .limit(1);
    return rows.length > 0;
  }

  async countChildrenByParent(): Promise<Map<string, number>> {
    const rows = await this.client.db
      .select({ parentId: categories.parentId, count: sql<number>`count(*)::int` })
      .from(categories)
      .where(sql`${categories.parentId} IS NOT NULL`)
      .groupBy(categories.parentId);
    return new Map(rows.map((r) => [r.parentId as string, r.count]));
  }

  async create(input: CreateCategoryInput): Promise<CategoryView> {
    const rows = await this.client.db
      .insert(categories)
      .values({
        parentId: input.parentId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
        kind: input.kind,
        supportsReservation: input.supportsReservation,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('categories insert returned no row');
    return rowToView(row);
  }

  async update(id: string, input: UpdateCategoryInput): Promise<CategoryView | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.parentId !== undefined) set.parentId = input.parentId;
    if (input.slug !== undefined) set.slug = input.slug;
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.icon !== undefined) set.icon = input.icon;
    if (input.color !== undefined) set.color = input.color;
    if (input.kind !== undefined) set.kind = input.kind;
    if (input.supportsReservation !== undefined)
      set.supportsReservation = input.supportsReservation;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    const rows = await this.client.db
      .update(categories)
      .set(set)
      .where(eq(categories.id, id))
      .returning();
    return rows[0] ? rowToView(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.client.db.delete(categories).where(eq(categories.id, id));
  }

  async reorder(parentId: string | null, ids: string[]): Promise<void> {
    // Each id gets its position; ownership (all ids live under `parentId`) is
    // validated by the service before this call.
    await this.client.db.transaction(async (tx) => {
      let i = 0;
      for (const id of ids) {
        await tx
          .update(categories)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(eq(categories.id, id));
        i++;
      }
    });
  }
}
