import { describe, expect, it, vi } from 'vitest';
import {
  CategoriesService,
  type CategoryBusinessCounter,
} from '../src/modules/catalog/categories/categories.service.js';
import type {
  CategoriesRepositoryLike,
  CategoryTreeNode,
  CategoryView,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../src/modules/catalog/categories/categories.repository.js';

/**
 * CategoriesService unit tests (B2.2). An in-memory fake repository + stub
 * cache/business-counter exercise the depth + move + delete rules without a
 * DB (the integration paths self-skip here and run on a Docker machine).
 */
class FakeCatsRepo implements CategoriesRepositoryLike {
  rows = new Map<string, CategoryView>();
  private seq = 0;
  private id() {
    this.seq += 1;
    return `${this.seq}`.padStart(36, '0').replace(/^./, 'a');
  }

  async listActiveTree(): Promise<CategoryTreeNode[]> {
    const active = [...this.rows.values()].filter((c) => c.isActive);
    const roots = active
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return roots.map((r) => ({
      ...r,
      children: active.filter((c) => c.parentId === r.id).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }
  async findActiveBySlug(slug: string): Promise<CategoryView | null> {
    return [...this.rows.values()].find((c) => c.slug === slug && c.isActive) ?? null;
  }
  async listActiveChildren(parentId: string): Promise<CategoryView[]> {
    return [...this.rows.values()]
      .filter((c) => c.parentId === parentId && c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async listAll(): Promise<CategoryView[]> {
    return [...this.rows.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async findById(id: string): Promise<CategoryView | null> {
    return this.rows.get(id) ?? null;
  }
  async findBySlug(slug: string): Promise<CategoryView | null> {
    return [...this.rows.values()].find((c) => c.slug === slug) ?? null;
  }
  async slugExists(slug: string, exceptId?: string): Promise<boolean> {
    return [...this.rows.values()].some((c) => c.slug === slug && c.id !== exceptId);
  }
  async hasChildren(id: string): Promise<boolean> {
    return [...this.rows.values()].some((c) => c.parentId === id);
  }
  async countChildrenByParent(): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const c of this.rows.values())
      if (c.parentId) m.set(c.parentId, (m.get(c.parentId) ?? 0) + 1);
    return m;
  }
  async create(input: CreateCategoryInput): Promise<CategoryView> {
    const id = this.id();
    const view: CategoryView = { id, ...input };
    this.rows.set(id, view);
    return view;
  }
  async update(id: string, input: UpdateCategoryInput): Promise<CategoryView | null> {
    const cur = this.rows.get(id);
    if (!cur) return null;
    const next = { ...cur, ...input, id };
    this.rows.set(id, next);
    return next;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
  async reorder(_parentId: string | null, ids: string[]): Promise<void> {
    ids.forEach((id, i) => {
      const c = this.rows.get(id);
      if (c) this.rows.set(id, { ...c, sortOrder: i });
    });
  }
}

function makeService(businessCount = 0) {
  const repo = new FakeCatsRepo();
  const cache = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    wrap: async (_k: string, _t: number, p: () => Promise<unknown>) => p(),
  };
  const events = { emit: vi.fn() };
  const businessCounter: CategoryBusinessCounter = {
    countByCategory: vi.fn(async () => businessCount),
  };
  const service = new CategoriesService(
    repo,
    cache as unknown as ConstructorParameters<typeof CategoriesService>[1],
    events as unknown as ConstructorParameters<typeof CategoriesService>[2],
    businessCounter,
  );
  return { service, repo, events, businessCounter };
}

const ROOT = { fa: 'غذا', en: 'Food' };

async function seedRoot(service: ReturnType<typeof makeService>['service']) {
  return service.createCategory({ name: ROOT, icon: 'utensils' }, { id: 'a', role: 'admin' });
}

describe('CategoriesService (B2.2)', () => {
  it('derives a slug from the English name when omitted', async () => {
    const { service } = makeService();
    const cat = await seedRoot(service);
    expect(cat.slug).toBe('food');
  });

  it('allows creating a child under a root', async () => {
    const { service } = makeService();
    const root = await seedRoot(service);
    const child = await service.createCategory(
      {
        name: { fa: 'کافه', en: 'Cafe' },
        icon: 'coffee',
        parentId: root.id,
        kind: 'menu',
        supportsReservation: true,
      },
      { id: 'a', role: 'admin' },
    );
    expect(child.parentId).toBe(root.id);
  });

  it('refuses creating a grandchild (depth > 2) with 422', async () => {
    const { service } = makeService();
    const root = await seedRoot(service);
    const child = await service.createCategory(
      { name: { fa: 'کافه', en: 'Cafe' }, icon: 'coffee', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    await expect(
      service.createCategory(
        { name: { fa: 'اسپرسو', en: 'Espresso' }, icon: 'coffee', parentId: child.id },
        { id: 'a', role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses moving a node with children under a parent (would make grandchildren)', async () => {
    const { service, repo } = makeService();
    const root = await seedRoot(service);
    const otherRoot = await service.createCategory(
      { name: { fa: 'سلامت', en: 'Health' }, icon: 'heart-pulse' },
      { id: 'a', role: 'admin' },
    );
    const child = await service.createCategory(
      { name: { fa: 'کافه', en: 'Cafe' }, icon: 'coffee', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    void child;
    // give the child a child of its own directly in the repo (bypassing the
    // service depth guard) to simulate an existing grandchild scenario is
    // impossible by the rules — instead test moving a ROOT with children to
    // be a child of another root.
    await service.createCategory(
      { name: { fa: 'زنجیره', en: 'Chain' }, icon: 'store', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    // root now has children; moving it under otherRoot must be refused.
    await expect(
      service.updateCategory(root.id, { parentId: otherRoot.id }, { id: 'a', role: 'admin' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(repo.rows.get(root.id)?.parentId).toBeNull();
  });

  it('allows moving a child to a root (parentId null)', async () => {
    const { service } = makeService();
    const root = await seedRoot(service);
    const child = await service.createCategory(
      { name: { fa: 'کافه', en: 'Cafe' }, icon: 'coffee', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    const moved = await service.updateCategory(
      child.id,
      { parentId: null },
      { id: 'a', role: 'admin' },
    );
    expect(moved.parentId).toBeNull();
  });

  it('refuses moving to a parent that is itself a child', async () => {
    const { service } = makeService();
    const root = await seedRoot(service);
    const child = await service.createCategory(
      { name: { fa: 'کافه', en: 'Cafe' }, icon: 'coffee', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    // moving root under `child` (a child) → refused
    await expect(
      service.updateCategory(root.id, { parentId: child.id }, { id: 'a', role: 'admin' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses to delete a category that has children with 422', async () => {
    const { service, repo } = makeService();
    const root = await seedRoot(service);
    await service.createCategory(
      { name: { fa: 'کافه', en: 'Cafe' }, icon: 'coffee', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    await expect(service.deleteCategory(root.id, { id: 'a', role: 'admin' })).rejects.toMatchObject(
      {
        status: 422,
      },
    );
    expect(repo.rows.has(root.id)).toBe(true);
  });

  it('refuses to delete a category that has businesses with 422 + businessCount', async () => {
    const { service, repo } = makeService(5);
    const root = await seedRoot(service);
    await expect(service.deleteCategory(root.id, { id: 'a', role: 'admin' })).rejects.toMatchObject(
      {
        status: 422,
        response: { details: { businessCount: 5 } },
      },
    );
    expect(repo.rows.has(root.id)).toBe(true);
  });

  it('deletes a leaf with no children and no businesses', async () => {
    const { service, repo } = makeService(0);
    const root = await seedRoot(service);
    await service.deleteCategory(root.id, { id: 'a', role: 'admin' });
    expect(repo.rows.has(root.id)).toBe(false);
  });

  it('refuses reorder when ids do not share the given parentId', async () => {
    const { service } = makeService();
    const root = await seedRoot(service);
    const otherRoot = await service.createCategory(
      { name: { fa: 'سلامت', en: 'Health' }, icon: 'heart-pulse' },
      { id: 'a', role: 'admin' },
    );
    const childOfRoot = await service.createCategory(
      { name: { fa: 'کافه', en: 'Cafe' }, icon: 'coffee', parentId: root.id },
      { id: 'a', role: 'admin' },
    );
    // otherRoot is a root (parentId null) but childOfRoot is not — mixing them
    // under parentId=null must be refused.
    await expect(
      service.reorderCategories(
        { parentId: null, ids: [otherRoot.id, childOfRoot.id] },
        { id: 'a', role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});
