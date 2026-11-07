import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
// EventEmitter2, CacheService and SettingsService are constructor-injected:
// Nest reads their types at runtime via emitDecoratorMetadata, so they must
// stay value imports (do not "fix" to `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  slugify,
  type AdminCity,
  type City,
  type CreateCityBody,
  type CreateNeighborhoodBody,
  type Neighborhood,
  type PublicCity,
  type ReorderCitiesBody,
  type ReorderNeighborhoodsBody,
  type UpdateCityBody,
  type UpdateNeighborhoodBody,
} from '@app/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
import { GEO_REPOSITORY, type GeoRepositoryLike, type CityPublicView } from './geo.repository.js';
import { GEO_EVENTS } from './geo.events.js';

/**
 * Optional provider (B2.1) that supplies the business count per city for the
 * admin listing + delete guard. B2.4 registers a real implementation; until
 * then the geo module binds a stub returning 0 (no businesses yet).
 */
export const BUSINESS_COUNTER = Symbol('BUSINESS_COUNTER');
export interface BusinessCounter {
  countByCity(cityId: string): Promise<number>;
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

/** Map a repository view to the public city contract + isDefault flag. */
function toPublicCity(c: CityPublicView, defaultSlug: string): PublicCity {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    center: c.center,
    bbox: c.bbox,
    timezone: c.timezone,
    isDefault: c.slug === defaultSlug,
  };
}

@Injectable()
export class GeoService {
  constructor(
    @Inject(GEO_REPOSITORY) private readonly repo: GeoRepositoryLike,
    private readonly cache: CacheService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
    @Inject(BUSINESS_COUNTER) private readonly businessCounter: BusinessCounter,
  ) {}

  // ─── Public reads ──────────────────────────────────────────────────────

  /** Active cities, sorted, cached 60 s; the default city is flagged. */
  async listPublicCities(): Promise<PublicCity[]> {
    return this.cache.wrap('geo:cities', 60, async () => {
      const rows = await this.repo.listPublicCities();
      const defaultSlug = await this.settings.get<string>('geo.defaultCitySlug');
      return rows.map((c) => toPublicCity(c, defaultSlug));
    });
  }

  async getPublicCity(slug: string): Promise<PublicCity> {
    const cached = await this.cache.get<PublicCity | null>(`geo:city:${slug}`);
    if (cached !== null) return cached;
    const city = await this.repo.findPublicCityBySlug(slug);
    if (!city) throw notFoundException('City', slug);
    const defaultSlug = await this.settings.get<string>('geo.defaultCitySlug');
    const view = toPublicCity(city, defaultSlug);
    await this.cache.set(`geo:city:${slug}`, view, 60);
    return view;
  }

  async listPublicNeighborhoods(slug: string): Promise<Neighborhood[]> {
    const cached = await this.cache.get<Neighborhood[] | null>(`geo:city:${slug}:neighborhoods`);
    if (cached !== null) return cached;
    const city = await this.repo.findPublicCityBySlug(slug);
    if (!city) throw notFoundException('City', slug);
    const rows = await this.repo.listPublicNeighborhoods(city.id);
    await this.cache.set(`geo:city:${slug}:neighborhoods`, rows, 60);
    return rows;
  }

  // ─── Admin: cities ─────────────────────────────────────────────────────

  async listAdminCities(): Promise<AdminCity[]> {
    const rows = await this.repo.listAllCities();
    const neighCounts = await this.repo.countNeighborhoodsByCity();
    const result: AdminCity[] = [];
    for (const c of rows) {
      const businessCount = await this.businessCounter.countByCity(c.id);
      result.push({
        id: c.id,
        slug: c.slug,
        name: c.name,
        center: c.center,
        bbox: c.bbox,
        timezone: c.timezone,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        neighborhoodCount: neighCounts.get(c.id) ?? 0,
        businessCount,
      });
    }
    return result;
  }

  /** Derive a slug from the name (English preferred, else Persian) + collision suffix. */
  private async generateCitySlug(name: Record<string, string>): Promise<string> {
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
    while (await this.repo.citySlugExists(slug)) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  private async generateNeighborhoodSlug(
    cityId: string,
    name: Record<string, string>,
  ): Promise<string> {
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
    while (await this.repo.neighborhoodSlugExists(cityId, slug)) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  async createCity(body: CreateCityBody, actor: AuditActor): Promise<City> {
    const slug = body.slug ?? (await this.generateCitySlug(body.name));
    if (await this.repo.citySlugExists(slug)) throw conflictException('slug', slug);
    try {
      const city = await this.repo.createCity({
        slug,
        name: body.name,
        center: body.center,
        bbox: body.bbox ?? null,
        timezone: body.timezone ?? 'Asia/Tehran',
        isActive: body.isActive ?? false,
        sortOrder: body.sortOrder ?? 0,
      });
      this.events.emit(GEO_EVENTS.cityCreated, { cityId: city.id, slug, actor });
      await this.invalidateCityCache();
      return city;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflictException('slug', slug);
      throw err;
    }
  }

  async updateCity(id: string, body: UpdateCityBody, actor: AuditActor): Promise<City> {
    const existing = await this.repo.findCityById(id);
    if (!existing) throw notFoundException('City', id);
    if (body.slug !== undefined && body.slug !== existing.slug) {
      if (await this.repo.citySlugExists(body.slug, id)) throw conflictException('slug', body.slug);
    }
    const updated = await this.repo.updateCity(id, {
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.center !== undefined ? { center: body.center } : {}),
      ...(body.bbox !== undefined ? { bbox: body.bbox } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    if (!updated) throw notFoundException('City', id);
    this.events.emit(GEO_EVENTS.cityUpdated, { cityId: id, slug: updated.slug, actor });
    await this.invalidateCityCache(existing.slug);
    if (body.slug !== undefined && body.slug !== existing.slug)
      await this.invalidateCityCache(body.slug);
    return updated;
  }

  async setCityActive(id: string, isActive: boolean, actor: AuditActor): Promise<City> {
    const existing = await this.repo.findCityById(id);
    if (!existing) throw notFoundException('City', id);
    const wasActive = existing.isActive;
    const updated = await this.repo.updateCity(id, { isActive });
    if (!updated) throw notFoundException('City', id);
    if (wasActive && !isActive) {
      this.events.emit(GEO_EVENTS.cityDeactivated, { cityId: id, slug: existing.slug, actor });
    }
    await this.invalidateCityCache(existing.slug);
    return updated;
  }

  async deleteCity(id: string, actor: AuditActor): Promise<void> {
    const existing = await this.repo.findCityById(id);
    if (!existing) throw notFoundException('City', id);
    const businessCount = await this.businessCounter.countByCity(id);
    if (businessCount > 0) {
      throw new HttpException(
        {
          code: 'UNPROCESSABLE' as const,
          messageKey: 'errors.unprocessable',
          message: 'city has businesses; deactivate it instead of deleting',
          details: { businessCount },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.repo.deleteCity(id);
    this.events.emit(GEO_EVENTS.cityDeleted, { cityId: id, slug: existing.slug, actor });
    await this.invalidateCityCache(existing.slug);
  }

  async reorderCities(body: ReorderCitiesBody, actor: AuditActor): Promise<void> {
    for (const id of body.ids) {
      if (!(await this.repo.findCityById(id))) throw notFoundException('City', id);
    }
    await this.repo.reorderCities(body.ids);
    this.events.emit(GEO_EVENTS.cityReordered, { actor });
    await this.invalidateCityCache();
  }

  // ─── Admin: neighborhoods ──────────────────────────────────────────────

  async listAdminNeighborhoods(cityId: string): Promise<Neighborhood[]> {
    const city = await this.repo.findCityById(cityId);
    if (!city) throw notFoundException('City', cityId);
    return this.repo.listAllNeighborhoodsByCity(cityId);
  }

  async createNeighborhood(
    cityId: string,
    body: CreateNeighborhoodBody,
    _actor: AuditActor,
  ): Promise<Neighborhood> {
    const city = await this.repo.findCityById(cityId);
    if (!city) throw notFoundException('City', cityId);
    const slug = body.slug ?? (await this.generateNeighborhoodSlug(cityId, body.name));
    if (await this.repo.neighborhoodSlugExists(cityId, slug)) throw conflictException('slug', slug);
    try {
      const n = await this.repo.createNeighborhood(cityId, {
        slug,
        name: body.name,
        center: body.center,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
      });
      await this.invalidateCityCache(city.slug);
      return n;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflictException('slug', slug);
      throw err;
    }
  }

  async updateNeighborhood(
    cityId: string,
    id: string,
    body: UpdateNeighborhoodBody,
    _actor: AuditActor,
  ): Promise<Neighborhood> {
    const city = await this.repo.findCityById(cityId);
    if (!city) throw notFoundException('City', cityId);
    const existing = await this.repo.findNeighborhoodById(id);
    if (!existing || existing.cityId !== cityId) throw notFoundException('Neighborhood', id);
    if (body.slug !== undefined && body.slug !== existing.slug) {
      if (await this.repo.neighborhoodSlugExists(cityId, body.slug, id))
        throw conflictException('slug', body.slug);
    }
    const updated = await this.repo.updateNeighborhood(id, {
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.center !== undefined ? { center: body.center } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    if (!updated) throw notFoundException('Neighborhood', id);
    await this.invalidateCityCache(city.slug);
    return updated;
  }

  async deleteNeighborhood(cityId: string, id: string, _actor: AuditActor): Promise<void> {
    const city = await this.repo.findCityById(cityId);
    if (!city) throw notFoundException('City', cityId);
    const existing = await this.repo.findNeighborhoodById(id);
    if (!existing || existing.cityId !== cityId) throw notFoundException('Neighborhood', id);
    await this.repo.deleteNeighborhood(id);
    await this.invalidateCityCache(city.slug);
  }

  async reorderNeighborhoods(
    cityId: string,
    body: ReorderNeighborhoodsBody,
    _actor: AuditActor,
  ): Promise<void> {
    const city = await this.repo.findCityById(cityId);
    if (!city) throw notFoundException('City', cityId);
    for (const id of body.ids) {
      const n = await this.repo.findNeighborhoodById(id);
      if (!n || n.cityId !== cityId) throw notFoundException('Neighborhood', id);
    }
    await this.repo.reorderNeighborhoods(cityId, body.ids);
    await this.invalidateCityCache(city.slug);
  }

  // ─── cache invalidation ────────────────────────────────────────────────

  private async invalidateCityCache(slug?: string): Promise<void> {
    await this.cache.del('geo:cities');
    if (slug) {
      await this.cache.del(`geo:city:${slug}`);
      await this.cache.del(`geo:city:${slug}:neighborhoods`);
    }
  }
}
