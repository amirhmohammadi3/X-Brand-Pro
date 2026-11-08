import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
// EventEmitter2 + CacheService are constructor-injected: Nest reads their types
// at runtime via emitDecoratorMetadata, so they must stay value imports.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { slugify } from '@app/contracts';
import {
  type AdminCategory,
  type Category,
  type CreateCategoryBody,
  type PublicCategoryLeaf,
  type PublicCategoryNode,
  type ReorderCategoriesBody,
  type UpdateCategoryBody,
} from '@app/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../../redis/cache.service.js';
import {
  CATEGORIES_REPOSITORY,
  type CategoryTreeNode,
  type CategoryView,
  type CategoriesRepositoryLike,
} from './categories.repository.js';

/** Optional provider (B2.2) — business count per category for the admin list +
 * delete guard. B2.4 registers the real one; until then a stub returns 0. */
export const CATEGORY_BUSINESS_COUNTER = Symbol('CATEGORY_BUSINESS_COUNTER');
export interface CategoryBusinessCounter {
  countByCategory(categoryId: string): Promise<number>;
}

interface AuditActor {
  id: string | null;
  role: string | null;
}

function conflictException(field: string, value: string): HttpException {
  return new HttpException(
    {
      code: 'CONFLICT' as const,
      messageKey: 'errors.conflict',
      message: `${field} '${value}' already exists`,
      details: { field },
    },
    HttpStatus.CONFLICT,
  );
}
function notFoundException(what: string, id: string): NotFoundException {
  return new NotFoundException(`${what} ${id} not found`);
}
function unprocessable(message: string, details: Record<string, unknown>): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE' as const, messageKey: 'errors.unprocessable', message, details },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function toPublicLeaf(c: CategoryView): PublicCategoryLeaf {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    kind: c.kind,
    supportsReservation: c.supportsReservation,
  };
}
function toPublicNode(node: CategoryTreeNode): PublicCategoryNode {
  return { ...toPublicLeaf(node), children: node.children.map(toPublicLeaf) };
}

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(CATEGORIES_REPOSITORY) private readonly repo: CategoriesRepositoryLike,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
    @Inject(CATEGORY_BUSINESS_COUNTER) private readonly businessCounter: CategoryBusinessCounter,
  ) {}

  // ─── Public reads ──────────────────────────────────────────────────────

  /** Active tree (roots + active children), cached 60 s. A root whose children
   * are all inactive still appears (with an empty children array). */
  async listPublicTree(): Promise<PublicCategoryNode[]> {
    return this.cache.wrap('catalog:categories:tree', 60, async () => {
      const tree = await this.repo.listActiveTree();
      return tree.map(toPublicNode);
    });
  }

  /** Active category by slug with its active children (if a root) and a parent
   * summary (if a child). 404 for inactive/unknown. */
  async getPublicCategory(slug: string): Promise<{
    id: string;
    slug: string;
    name: Record<string, string>;
    description: Record<string, string> | null;
    icon: string;
    color: string | null;
    kind: 'menu' | 'services' | 'none';
    supportsReservation: boolean;
    children: PublicCategoryLeaf[];
    parent: { slug: string; name: Record<string, string> } | null;
  }> {
    const cat = await this.repo.findActiveBySlug(slug);
    if (!cat) throw notFoundException('Category', slug);
    const children = cat.parentId === null ? await this.repo.listActiveChildren(cat.id) : [];
    const parentRow = cat.parentId ? await this.repo.findById(cat.parentId) : null;
    const parent =
      parentRow && parentRow.isActive ? { slug: parentRow.slug, name: parentRow.name } : null;
    return { ...toPublicLeaf(cat), children: children.map(toPublicLeaf), parent };
  }

  // ─── Admin ─────────────────────────────────────────────────────────────

  async listAdminCategories(): Promise<AdminCategory[]> {
    const rows = await this.repo.listAll();
    const childCounts = await this.repo.countChildrenByParent();
    const result: AdminCategory[] = [];
    for (const c of rows) {
      const businessCount = await this.businessCounter.countByCategory(c.id);
      result.push({
        id: c.id,
        parentId: c.parentId,
        slug: c.slug,
        name: c.name,
        description: c.description,
        icon: c.icon,
        color: c.color,
        kind: c.kind,
        supportsReservation: c.supportsReservation,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        childCount: childCounts.get(c.id) ?? 0,
        businessCount,
      });
    }
    return result;
  }

  /** Derive a slug from the name (English preferred, else Persian) + collision suffix. */
  private async generateSlug(name: Record<string, string>): Promise<string> {
    const en = name.en;
    const base = slugify(en && en.trim().length > 0 ? en : (name.fa ?? ''));
    if (!base) {
      throw new HttpException(
        {
          code: 'VALIDATION_FAILED',
          message: 'slug could not be derived from name',
          details: { field: 'slug' },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    let slug = base;
    let n = 2;
    while (await this.repo.slugExists(slug)) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  async createCategory(body: CreateCategoryBody, actor: AuditActor): Promise<Category> {
    // Depth rule: a child may not have children. If a parent is given, it must
    // itself be a root (parent_id null).
    if (body.parentId) {
      const parent = await this.repo.findById(body.parentId);
      if (!parent) throw notFoundException('Category', body.parentId);
      if (parent.parentId !== null) {
        throw unprocessable('parent is itself a child; maximum depth is two levels', {
          field: 'parentId',
        });
      }
    }
    const slug = body.slug ?? (await this.generateSlug(body.name));
    if (await this.repo.slugExists(slug)) throw conflictException('slug', slug);
    try {
      const cat = await this.repo.create({
        parentId: body.parentId ?? null,
        slug,
        name: body.name,
        description: body.description ?? null,
        icon: body.icon,
        color: body.color ?? null,
        kind: body.kind ?? 'none',
        supportsReservation: body.supportsReservation ?? false,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
      });
      this.events.emit('catalog.category.created', { categoryId: cat.id, slug, actor });
      await this.invalidateCache();
      return cat;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflictException('slug', slug);
      throw err;
    }
  }

  async updateCategory(id: string, body: UpdateCategoryBody, actor: AuditActor): Promise<Category> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Category', id);
    if (body.slug !== undefined && body.slug !== existing.slug) {
      if (await this.repo.slugExists(body.slug, id)) throw conflictException('slug', body.slug);
    }
    // Move rules: moving to another parent is allowed only when the node has
    // no children OR it becomes a root (parentId null). The new parent (when
    // non-null) must be a root. Cycles are impossible under these rules.
    if (body.parentId !== undefined && body.parentId !== existing.parentId) {
      const newParentId = body.parentId;
      if (newParentId !== null) {
        if (newParentId === id)
          throw unprocessable('a category cannot be its own parent', { field: 'parentId' });
        const parent = await this.repo.findById(newParentId);
        if (!parent) throw notFoundException('Category', newParentId);
        if (parent.parentId !== null) {
          throw unprocessable('parent is itself a child; maximum depth is two levels', {
            field: 'parentId',
          });
        }
        if (await this.repo.hasChildren(id)) {
          throw unprocessable('cannot move a category that has children under a parent', {
            field: 'parentId',
          });
        }
      }
    }
    const updated = await this.repo.update(id, {
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.supportsReservation !== undefined
        ? { supportsReservation: body.supportsReservation }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    if (!updated) throw notFoundException('Category', id);
    this.events.emit('catalog.category.updated', { categoryId: id, slug: updated.slug, actor });
    await this.invalidateCache();
    return updated;
  }

  async setCategoryActive(id: string, isActive: boolean, actor: AuditActor): Promise<Category> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Category', id);
    const updated = await this.repo.update(id, { isActive });
    if (!updated) throw notFoundException('Category', id);
    if (existing.isActive && !isActive) {
      this.events.emit('catalog.category.deactivated', {
        categoryId: id,
        slug: existing.slug,
        actor,
      });
    }
    await this.invalidateCache();
    return updated;
  }

  async deleteCategory(id: string, actor: AuditActor): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Category', id);
    if (await this.repo.hasChildren(id)) {
      throw unprocessable('category has children; deactivate it instead of deleting', {
        hasChildren: true,
      });
    }
    const businessCount = await this.businessCounter.countByCategory(id);
    if (businessCount > 0) {
      throw unprocessable('category has businesses; deactivate it instead of deleting', {
        businessCount,
      });
    }
    await this.repo.delete(id);
    this.events.emit('catalog.category.deleted', { categoryId: id, slug: existing.slug, actor });
    await this.invalidateCache();
  }

  async reorderCategories(body: ReorderCategoriesBody, _actor: AuditActor): Promise<void> {
    for (const id of body.ids) {
      const c = await this.repo.findById(id);
      if (!c) throw notFoundException('Category', id);
      if (c.parentId !== body.parentId) {
        throw unprocessable('all ids must share the given parentId', { field: 'parentId' });
      }
    }
    await this.repo.reorder(body.parentId, body.ids);
    await this.invalidateCache();
  }

  private async invalidateCache(): Promise<void> {
    await this.cache.del('catalog:categories:tree');
  }
}
