import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
// EventEmitter2 + CacheService are constructor-injected: Nest reads their types
// at runtime via emitDecoratorMetadata, so they must stay value imports.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { slugify } from '@app/contracts';
import type {
  Amenity,
  CreateAmenityBody,
  SetCategoryAmenitiesBody,
  UpdateAmenityBody,
} from '@app/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../../redis/cache.service.js';
import {
  AMENITIES_REPOSITORY,
  type AmenitiesRepositoryLike,
  type MappedAmenityView,
} from './amenities.repository.js';

/** Optional provider (B2.3) — business usage count per amenity for the delete
 * guard. B2.4 registers the real one; until then a stub returns 0. */
export const AMENITY_USAGE_COUNTER = Symbol('AMENITY_USAGE_COUNTER');
export interface AmenityUsageCounter {
  countByAmenity(amenityId: string): Promise<number>;
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

@Injectable()
export class AmenitiesService {
  constructor(
    @Inject(AMENITIES_REPOSITORY) private readonly repo: AmenitiesRepositoryLike,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
    @Inject(AMENITY_USAGE_COUNTER) private readonly usageCounter: AmenityUsageCounter,
  ) {}

  // ─── Public reads ──────────────────────────────────────────────────────

  /** Active amenities, optionally filtered to a category (inheriting the
   * parent's mappings). Cached 60 s. */
  async listPublicAmenities(categorySlug?: string): Promise<Amenity[] | MappedAmenityView[]> {
    if (!categorySlug) {
      return this.cache.wrap('catalog:amenities:all', 60, () => this.repo.listActive());
    }
    const cached = await this.cache.get<Amenity[] | null>(`catalog:amenities:cat:${categorySlug}`);
    if (cached) return cached;
    const cat = await this.repo.resolveCategory(categorySlug);
    if (!cat) throw notFoundException('Category', categorySlug);
    const items = await this.repo.listActiveForCategory(cat.id, cat.parentId);
    await this.cache.set(`catalog:amenities:cat:${categorySlug}`, items, 60);
    return items;
  }

  // ─── Admin: amenities ──────────────────────────────────────────────────

  async listAdminAmenities(): Promise<Amenity[]> {
    return this.repo.listAll();
  }

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

  async createAmenity(body: CreateAmenityBody, actor: AuditActor): Promise<Amenity> {
    const slug = body.slug ?? (await this.generateSlug(body.name));
    if (await this.repo.slugExists(slug)) throw conflictException('slug', slug);
    try {
      const amenity = await this.repo.create({
        slug,
        name: body.name,
        icon: body.icon,
        group: body.group ?? 'general',
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
      });
      this.events.emit('catalog.amenity.created', { amenityId: amenity.id, slug, actor });
      await this.invalidateCache();
      return amenity;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflictException('slug', slug);
      throw err;
    }
  }

  async updateAmenity(id: string, body: UpdateAmenityBody, actor: AuditActor): Promise<Amenity> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Amenity', id);
    if (body.slug !== undefined && body.slug !== existing.slug) {
      if (await this.repo.slugExists(body.slug, id)) throw conflictException('slug', body.slug);
    }
    const updated = await this.repo.update(id, {
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.group !== undefined ? { group: body.group } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    if (!updated) throw notFoundException('Amenity', id);
    this.events.emit('catalog.amenity.updated', { amenityId: id, slug: updated.slug, actor });
    await this.invalidateCache();
    return updated;
  }

  async setAmenityActive(id: string, isActive: boolean, actor: AuditActor): Promise<Amenity> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Amenity', id);
    const updated = await this.repo.update(id, { isActive });
    if (!updated) throw notFoundException('Amenity', id);
    if (existing.isActive && !isActive) {
      this.events.emit('catalog.amenity.deactivated', {
        amenityId: id,
        slug: existing.slug,
        actor,
      });
    }
    await this.invalidateCache();
    return updated;
  }

  async deleteAmenity(id: string, actor: AuditActor): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Amenity', id);
    const usageCount = await this.usageCounter.countByAmenity(id);
    if (usageCount > 0) {
      throw new HttpException(
        {
          code: 'UNPROCESSABLE' as const,
          messageKey: 'errors.unprocessable',
          message: 'amenity is used by businesses; deactivate it instead of deleting',
          details: { businessCount: usageCount },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.repo.delete(id);
    this.events.emit('catalog.amenity.deleted', { amenityId: id, slug: existing.slug, actor });
    await this.invalidateCache();
  }

  // ─── Admin: category ↔ amenity mapping ─────────────────────────────────

  async getCategoryAmenities(categoryId: string): Promise<string[]> {
    return this.repo.getCategoryAmenityIds(categoryId);
  }

  async replaceCategoryAmenities(
    categoryId: string,
    body: SetCategoryAmenitiesBody,
    _actor: AuditActor,
  ): Promise<MappedAmenityView[]> {
    // validate every amenity id exists (404 otherwise)
    for (const aid of body.amenityIds) {
      if (!(await this.repo.findById(aid))) throw notFoundException('Amenity', aid);
    }
    const mapped = await this.repo.replaceCategoryAmenities(categoryId, body.amenityIds);
    await this.invalidateCache();
    return mapped;
  }

  private async invalidateCache(): Promise<void> {
    await this.cache.del('catalog:amenities:all');
    // category-scoped keys are namespaced; a write may affect any category, so
    // we cannot cheaply enumerate them — the 60 s TTL bounds staleness. The
    // mapping-replace path is the common invalidation trigger and is rare.
  }
}
