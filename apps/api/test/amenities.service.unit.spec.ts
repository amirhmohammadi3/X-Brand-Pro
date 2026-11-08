import { describe, expect, it, vi } from 'vitest';
import {
  AmenitiesService,
  type AmenityUsageCounter,
} from '../src/modules/catalog/amenities/amenities.service.js';
import type {
  AmenitiesRepositoryLike,
  AmenityView,
  CreateAmenityInput,
  MappedAmenityView,
  UpdateAmenityInput,
} from '../src/modules/catalog/amenities/amenities.repository.js';

/**
 * AmenitiesService unit tests (B2.3). An in-memory fake repository + stub
 * cache/usage-counter exercise the slug/collision, delete-refusal, mapping
 * validation and parent-inheritance logic without a DB.
 */
class FakeAmenRepo implements AmenitiesRepositoryLike {
  amenities = new Map<string, AmenityView>();
  mappings = new Map<string, string[]>(); // categoryId → amenityIds (ordered)
  categories = new Map<string, { id: string; parentId: string | null; slug: string }>();
  private seq = 0;
  private id() {
    this.seq += 1;
    return `${this.seq}`.padStart(36, '0').replace(/^./, 'b');
  }

  async listActive(): Promise<AmenityView[]> {
    return [...this.amenities.values()]
      .filter((a) => a.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async listActiveForCategory(
    categoryId: string,
    parentCategoryId: string | null,
  ): Promise<MappedAmenityView[]> {
    const catIds = parentCategoryId ? [categoryId, parentCategoryId] : [categoryId];
    const seen = new Map<string, AmenityView>();
    for (const cid of catIds) {
      for (const aid of this.mappings.get(cid) ?? []) {
        const a = this.amenities.get(aid);
        if (a && a.isActive && !seen.has(a.id)) seen.set(a.id, a);
      }
    }
    return [...seen.values()].map((a, i) => ({ ...a, mappingSortOrder: i }));
  }
  async listAll(): Promise<AmenityView[]> {
    return [...this.amenities.values()];
  }
  async findById(id: string): Promise<AmenityView | null> {
    return this.amenities.get(id) ?? null;
  }
  async findBySlug(slug: string): Promise<AmenityView | null> {
    return [...this.amenities.values()].find((a) => a.slug === slug) ?? null;
  }
  async slugExists(slug: string, exceptId?: string): Promise<boolean> {
    return [...this.amenities.values()].some((a) => a.slug === slug && a.id !== exceptId);
  }
  async create(input: CreateAmenityInput): Promise<AmenityView> {
    const id = this.id();
    const v: AmenityView = { id, ...input };
    this.amenities.set(id, v);
    return v;
  }
  async update(id: string, input: UpdateAmenityInput): Promise<AmenityView | null> {
    const cur = this.amenities.get(id);
    if (!cur) return null;
    const next = { ...cur, ...input, id };
    this.amenities.set(id, next);
    return next;
  }
  async delete(id: string): Promise<void> {
    this.amenities.delete(id);
  }
  async getCategoryAmenityIds(categoryId: string): Promise<string[]> {
    return [...(this.mappings.get(categoryId) ?? [])];
  }
  async replaceCategoryAmenities(
    categoryId: string,
    amenityIds: string[],
  ): Promise<MappedAmenityView[]> {
    this.mappings.set(categoryId, [...amenityIds]);
    return this.listActiveForCategory(categoryId, null);
  }
  async resolveCategory(slug: string): Promise<{ id: string; parentId: string | null } | null> {
    const c = [...this.categories.values()].find((x) => x.slug === slug);
    return c ? { id: c.id, parentId: c.parentId } : null;
  }
}

function makeService(usageCount = 0) {
  const repo = new FakeAmenRepo();
  const cache = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    wrap: async (_k: string, _t: number, p: () => Promise<unknown>) => p(),
  };
  const events = { emit: vi.fn() };
  const usageCounter: AmenityUsageCounter = { countByAmenity: vi.fn(async () => usageCount) };
  const service = new AmenitiesService(
    repo,
    cache as unknown as ConstructorParameters<typeof AmenitiesService>[1],
    events as unknown as ConstructorParameters<typeof AmenitiesService>[2],
    usageCounter,
  );
  return { service, repo, events, usageCounter };
}

describe('AmenitiesService (B2.3)', () => {
  it('derives a slug from the English name when omitted', async () => {
    const { service } = makeService();
    const a = await service.createAmenity(
      { name: { fa: 'وای‌فای', en: 'Wi-Fi' }, icon: 'wifi' },
      { id: 'a', role: 'admin' },
    );
    expect(a.slug).toBe('wi-fi');
  });

  it('throws 409 CONFLICT on a duplicate slug', async () => {
    const { service, repo } = makeService();
    await repo.create({
      slug: 'wifi',
      name: { fa: 'وای‌فای', en: 'Wi-Fi' },
      icon: 'wifi',
      group: 'general',
      isActive: true,
      sortOrder: 0,
    });
    await expect(
      service.createAmenity(
        { slug: 'wifi', name: { fa: 'وای‌فای', en: 'Wi-Fi' }, icon: 'wifi' },
        { id: 'a', role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 409, response: { details: { field: 'slug' } } });
  });

  it('refuses to delete an amenity used by businesses with 422 + businessCount', async () => {
    const { service, repo } = makeService(4);
    const a = await repo.create({
      slug: 'parking',
      name: { fa: 'پارکینگ', en: 'Parking' },
      icon: 'parking-square',
      group: 'general',
      isActive: true,
      sortOrder: 0,
    });
    await expect(service.deleteAmenity(a.id, { id: 'a', role: 'admin' })).rejects.toMatchObject({
      status: 422,
      response: { details: { businessCount: 4 } },
    });
    expect(repo.amenities.has(a.id)).toBe(true);
  });

  it('deletes an amenity with no business usage', async () => {
    const { service, repo } = makeService(0);
    const a = await service.createAmenity(
      { name: { fa: 'پارکینگ', en: 'Parking' }, icon: 'parking-square' },
      { id: 'a', role: 'admin' },
    );
    await service.deleteAmenity(a.id, { id: 'a', role: 'admin' });
    expect(repo.amenities.has(a.id)).toBe(false);
  });

  it('refuses replaceCategoryAmenities when an amenity id does not exist (404)', async () => {
    const { service, repo } = makeService();
    const cat = { id: 'cat-1', parentId: null, slug: 'food' };
    repo.categories.set(cat.id, cat);
    await expect(
      service.replaceCategoryAmenities(
        cat.id,
        { amenityIds: ['00000000-0000-0000-0000-0000000000ff'] },
        { id: 'a', role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('includes the parent category amenities in the public list (inheritance)', async () => {
    const { service, repo } = makeService();
    // root "food" with amenity wifi; child "cafe" with amenity parking.
    const root = { id: 'root-1', parentId: null, slug: 'food' };
    const child = { id: 'child-1', parentId: root.id, slug: 'cafe' };
    repo.categories.set(root.id, root);
    repo.categories.set(child.id, child);
    const wifi = await repo.create({
      slug: 'wifi',
      name: { fa: 'وای‌فای', en: 'Wi-Fi' },
      icon: 'wifi',
      group: 'general',
      isActive: true,
      sortOrder: 0,
    });
    const parking = await repo.create({
      slug: 'parking',
      name: { fa: 'پارکینگ', en: 'Parking' },
      icon: 'parking-square',
      group: 'general',
      isActive: true,
      sortOrder: 1,
    });
    repo.mappings.set(root.id, [wifi.id]);
    repo.mappings.set(child.id, [parking.id]);
    const items = (await service.listPublicAmenities('cafe')) as MappedAmenityView[];
    const slugs = items.map((a) => a.slug).sort();
    expect(slugs).toEqual(['parking', 'wifi']);
  });

  it('hides inactive amenities from the public list', async () => {
    const { service, repo } = makeService();
    const cat = { id: 'cat-1', parentId: null, slug: 'food' };
    repo.categories.set(cat.id, cat);
    const active = await repo.create({
      slug: 'wifi',
      name: { fa: 'وای‌فای', en: 'Wi-Fi' },
      icon: 'wifi',
      group: 'general',
      isActive: true,
      sortOrder: 0,
    });
    const inactive = await repo.create({
      slug: 'smoking',
      name: { fa: 'سیگار', en: 'Smoking' },
      icon: 'no-smoking',
      group: 'general',
      isActive: false,
      sortOrder: 1,
    });
    repo.mappings.set(cat.id, [active.id, inactive.id]);
    const items = await service.listPublicAmenities('food');
    expect(items.map((a) => a.slug)).toEqual(['wifi']);
  });
});
