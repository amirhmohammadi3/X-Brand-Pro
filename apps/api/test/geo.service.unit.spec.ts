import { describe, expect, it, vi } from 'vitest';
import { GeoService, type BusinessCounter } from '../src/modules/geo/geo.service.js';
import { GEO_EVENTS } from '../src/modules/geo/geo.events.js';
import type {
  GeoRepositoryLike,
  CityPublicView,
  NeighborhoodPublicView,
  CreateCityInput,
  UpdateCityInput,
  CreateNeighborhoodInput,
  UpdateNeighborhoodInput,
} from '../src/modules/geo/geo.repository.js';
import type { GeoPoint } from '@app/contracts';

/**
 * GeoService unit tests (B2.1). A hand-written in-memory fake repository +
 * stub cache/settings/business-counter exercise the service logic (slug
 * generation + collision suffix, duplicate-slug conflict, delete refusal with
 * businessCount, reorder existence check, deactivation event) without a DB —
 * the integration paths are covered by the DB-requiring suites that self-skip
 * here and run on a Docker machine.
 */
class FakeGeoRepo implements GeoRepositoryLike {
  cities = new Map<string, CityPublicView>();
  neighborhoods = new Map<string, NeighborhoodPublicView>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`.padEnd(36, '0').slice(0, 36);
  }

  async listPublicCities(): Promise<CityPublicView[]> {
    return [...this.cities.values()]
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async findPublicCityBySlug(slug: string): Promise<CityPublicView | null> {
    const c = [...this.cities.values()].find((x) => x.slug === slug && x.isActive);
    return c ?? null;
  }
  async listPublicNeighborhoods(cityId: string): Promise<NeighborhoodPublicView[]> {
    return [...this.neighborhoods.values()].filter((n) => n.cityId === cityId && n.isActive);
  }
  async listAllCities(): Promise<CityPublicView[]> {
    return [...this.cities.values()];
  }
  async listAllNeighborhoodsByCity(cityId: string): Promise<NeighborhoodPublicView[]> {
    return [...this.neighborhoods.values()].filter((n) => n.cityId === cityId);
  }
  async findCityById(id: string): Promise<CityPublicView | null> {
    return this.cities.get(id) ?? null;
  }
  async findCityBySlug(slug: string): Promise<CityPublicView | null> {
    return [...this.cities.values()].find((c) => c.slug === slug) ?? null;
  }
  async citySlugExists(slug: string, exceptId?: string): Promise<boolean> {
    return [...this.cities.values()].some((c) => c.slug === slug && c.id !== exceptId);
  }
  async countNeighborhoodsByCity(): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const n of this.neighborhoods.values()) m.set(n.cityId, (m.get(n.cityId) ?? 0) + 1);
    return m;
  }
  async countNeighborhoodsForCity(cityId: string): Promise<number> {
    return [...this.neighborhoods.values()].filter((n) => n.cityId === cityId).length;
  }
  async createCity(input: CreateCityInput): Promise<CityPublicView> {
    const id = this.nextId('city');
    const view: CityPublicView = { id, ...input };
    this.cities.set(id, view);
    return view;
  }
  async updateCity(id: string, input: UpdateCityInput): Promise<CityPublicView | null> {
    const cur = this.cities.get(id);
    if (!cur) return null;
    const next = { ...cur, ...input, id };
    this.cities.set(id, next);
    return next;
  }
  async deleteCity(id: string): Promise<void> {
    this.cities.delete(id);
    for (const [nid, n] of this.neighborhoods) if (n.cityId === id) this.neighborhoods.delete(nid);
  }
  async reorderCities(ids: string[]): Promise<void> {
    ids.forEach((id, i) => {
      const c = this.cities.get(id);
      if (c) this.cities.set(id, { ...c, sortOrder: i });
    });
  }
  async findNeighborhoodByCityAndSlug(
    cityId: string,
    slug: string,
  ): Promise<NeighborhoodPublicView | null> {
    return (
      [...this.neighborhoods.values()].find((n) => n.cityId === cityId && n.slug === slug) ?? null
    );
  }
  async findNeighborhoodById(id: string): Promise<NeighborhoodPublicView | null> {
    return this.neighborhoods.get(id) ?? null;
  }
  async neighborhoodSlugExists(cityId: string, slug: string, exceptId?: string): Promise<boolean> {
    return [...this.neighborhoods.values()].some(
      (n) => n.cityId === cityId && n.slug === slug && n.id !== exceptId,
    );
  }
  async createNeighborhood(
    cityId: string,
    input: CreateNeighborhoodInput,
  ): Promise<NeighborhoodPublicView> {
    const id = this.nextId('neigh');
    const view: NeighborhoodPublicView = { id, cityId, ...input };
    this.neighborhoods.set(id, view);
    return view;
  }
  async updateNeighborhood(
    id: string,
    input: UpdateNeighborhoodInput,
  ): Promise<NeighborhoodPublicView | null> {
    const cur = this.neighborhoods.get(id);
    if (!cur) return null;
    const next = { ...cur, ...input, id, cityId: cur.cityId };
    this.neighborhoods.set(id, next);
    return next;
  }
  async deleteNeighborhood(id: string): Promise<void> {
    this.neighborhoods.delete(id);
  }
  async reorderNeighborhoods(_cityId: string, ids: string[]): Promise<void> {
    ids.forEach((id, i) => {
      const n = this.neighborhoods.get(id);
      if (n) this.neighborhoods.set(id, { ...n, sortOrder: i });
    });
  }
}

const TEHRAN_CENTER: GeoPoint = { lat: 35.6892, lng: 51.389 };

function makeService(opts: { businessCount?: number } = {}) {
  const repo = new FakeGeoRepo();
  const cache = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    wrap: async (_k: string, _t: number, p: () => Promise<unknown>) => p(),
  };
  const settings = {
    get: async (key: string) => (key === 'geo.defaultCitySlug' ? 'tehran' : undefined),
  };
  const events = { emit: vi.fn() };
  const businessCounter: BusinessCounter = {
    countByCity: vi.fn(async () => opts.businessCount ?? 0),
  };
  const service = new GeoService(
    repo,
    cache as unknown as ConstructorParameters<typeof GeoService>[1],
    settings as unknown as ConstructorParameters<typeof GeoService>[2],
    events as unknown as ConstructorParameters<typeof GeoService>[3],
    businessCounter,
  );
  return { service, repo, events, businessCounter };
}

describe('GeoService (B2.1)', () => {
  it('derives a slug from the English name when omitted', async () => {
    const { service } = makeService();
    const city = await service.createCity(
      { name: { fa: 'اصفهان', en: 'Isfahan' }, center: TEHRAN_CENTER },
      { id: 'a', role: 'admin' },
    );
    expect(city.slug).toBe('isfahan');
  });

  it('appends a -2 suffix when the derived slug already exists', async () => {
    const { service, repo } = makeService();
    await repo.createCity({
      slug: 'isfahan',
      name: { fa: 'اصفهان', en: 'Isfahan' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 0,
    });
    const city = await service.createCity(
      { name: { fa: 'اصفهان', en: 'Isfahan' }, center: TEHRAN_CENTER },
      { id: 'a', role: 'admin' },
    );
    expect(city.slug).toBe('isfahan-2');
  });

  it('throws 409 CONFLICT with details.field=slug on an explicit duplicate slug', async () => {
    const { service, repo } = makeService();
    await repo.createCity({
      slug: 'tehran',
      name: { fa: 'تهران', en: 'Tehran' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 0,
    });
    await expect(
      service.createCity(
        { slug: 'tehran', name: { fa: 'تهران', en: 'Tehran' }, center: TEHRAN_CENTER },
        { id: 'a', role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 409, response: { details: { field: 'slug' } } });
  });

  it('refuses to delete a city that has businesses with 422 + businessCount', async () => {
    const { service, repo } = makeService({ businessCount: 3 });
    const city = await repo.createCity({
      slug: 'tabriz',
      name: { fa: 'تبریز', en: 'Tabriz' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 0,
    });
    await expect(service.deleteCity(city.id, { id: 'a', role: 'admin' })).rejects.toMatchObject({
      status: 422,
      response: { details: { businessCount: 3 } },
    });
    expect(repo.cities.has(city.id)).toBe(true);
  });

  it('deletes a city with no businesses', async () => {
    const { service, repo } = makeService({ businessCount: 0 });
    const city = await repo.createCity({
      slug: 'shiraz',
      name: { fa: 'شیراز', en: 'Shiraz' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 0,
    });
    await service.deleteCity(city.id, { id: 'a', role: 'admin' });
    expect(repo.cities.has(city.id)).toBe(false);
  });

  it('refuses reorder when an id does not exist', async () => {
    const { service } = makeService();
    await expect(
      service.reorderCities(
        { ids: ['00000000-0000-0000-0000-0000000000aa'] },
        { id: 'a', role: 'admin' },
      ),
    ).rejects.toThrow();
  });

  it('emits city.deactivated only when an active city is deactivated', async () => {
    const { service, repo, events } = makeService();
    const city = await repo.createCity({
      slug: 'karaj',
      name: { fa: 'کرج', en: 'Karaj' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 0,
    });
    await service.setCityActive(city.id, false, { id: 'a', role: 'admin' });
    expect(events.emit).toHaveBeenCalledWith(
      GEO_EVENTS.cityDeactivated,
      expect.objectContaining({ cityId: city.id }),
    );
    events.emit.mockClear();
    // reactivating does not emit deactivation
    await service.setCityActive(city.id, true, { id: 'a', role: 'admin' });
    expect(events.emit).not.toHaveBeenCalledWith(GEO_EVENTS.cityDeactivated, expect.anything());
  });

  it('flags the default city with isDefault in the public list', async () => {
    const { service, repo } = makeService();
    await repo.createCity({
      slug: 'tehran',
      name: { fa: 'تهران', en: 'Tehran' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 0,
    });
    await repo.createCity({
      slug: 'isfahan',
      name: { fa: 'اصفهان', en: 'Isfahan' },
      center: TEHRAN_CENTER,
      bbox: null,
      timezone: 'Asia/Tehran',
      isActive: true,
      sortOrder: 1,
    });
    const items = await service.listPublicCities();
    expect(items.find((c) => c.slug === 'tehran')?.isDefault).toBe(true);
    expect(items.find((c) => c.slug === 'isfahan')?.isDefault).toBe(false);
  });
});
