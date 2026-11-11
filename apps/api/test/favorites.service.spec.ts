import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { FavoritesService, FAVORITES_EVENTS } from '../src/modules/favorites/favorites.service.js';
import type {
  FavoriteItemWithContext,
  FavoriteListMeta,
  FavoriteListSummaryRow,
  FavoritesRepositoryLike,
} from '../src/modules/favorites/favorites.repository.js';
import type { BusinessSummary } from '@app/contracts';
import {
  FAVORITE_DEFAULT_LIST_NAME,
  FAVORITE_MAX_ITEMS_PER_LIST,
  FAVORITE_MAX_LISTS_PER_USER,
} from '@app/contracts';

/**
 * B5.1 FavoritesService — the business rules, DB-free: the lazy default
 * list (write-only, never on a read), the reserved default name, the
 * one-list-per-(user,business) invariant surfacing as 409, the caps
 * (max lists / max items per list), the active-only business gate, the
 * 404-never-leak rule (foreign ids answer the same 404 as missing ones),
 * the undeletable default list, the note/move PATCH semantics and the
 * domain events. The repository SQL (unique indexes, pagination, cascades)
 * is integration-tested against Docker per the Follow-up.
 */

const USER = { id: '22222222-2222-4222-8222-222222222222', role: 'user' };
const STRANGER = { id: '33333333-3333-4333-8333-333333333333', role: 'user' };
const BIZ = '11111111-1111-4111-8111-111111111111';
const BIZ2 = '12121212-1212-4212-8212-121212121212';
const PENDING_BIZ = '13131313-1313-4313-8313-131313131313';
const DELETED_BIZ = '14141414-1414-4414-8414-141414141414';
const DEFAULT_LIST = '51515151-5151-4551-8551-515151515151';
const LIST_A = '52525252-5252-4652-8652-525252525252';
const LIST_B = '53535353-5353-4753-8753-535353535353';

function listRow(overrides: Partial<FavoriteListMeta> = {}): FavoriteListMeta {
  return {
    id: LIST_A,
    userId: USER.id,
    name: 'کافه‌های تهران',
    isDefault: false,
    createdAt: new Date('2026-11-11T09:00:00Z'),
    updatedAt: new Date('2026-11-11T09:00:00Z'),
    ...overrides,
  };
}

function businessCard(id: string): BusinessSummary {
  return {
    id,
    slug: `biz-${id.slice(0, 4)}`,
    name: 'کافه نمونه',
    nameAlt: null,
    primaryCategory: {
      id: '61616161-6161-4616-8661-616161616161',
      slug: 'cafe',
      name: { fa: 'کافه' },
    },
    city: { id: '62626262-6262-4626-8662-626262626262', slug: 'tehran', name: { fa: 'تهران' } },
    neighborhood: null,
    address: 'تهران، خیابان نمونه',
    location: { lat: 35.7, lng: 51.4 },
    priceLevel: 2,
    avgRating: 4.5,
    reviewCount: 12,
    coverUrl: null,
    thumbUrl: null,
    isFeatured: false,
    isClaimed: false,
  };
}

/** In-memory favorites repo mirroring the SQL semantics the service relies on. */
function makeRepo(initialLists: FavoriteListMeta[] = []) {
  const lists = new Map(initialLists.map((l) => [l.id, { ...l }]));
  const items = new Map<
    string,
    {
      id: string;
      userId: string;
      listId: string;
      businessId: string;
      note: string | null;
      createdAt: Date;
    }
  >();
  const biz = new Map<string, { status: string; deletedAt: Date | null }>([
    [BIZ, { status: 'active', deletedAt: null }],
    [BIZ2, { status: 'active', deletedAt: null }],
    [PENDING_BIZ, { status: 'pending', deletedAt: null }],
    [DELETED_BIZ, { status: 'active', deletedAt: new Date() }],
  ]);
  let seq = 0;
  const nextId = () => `9${String(++seq).padStart(7, '0')}-9999-4999-8999-999999999999`;
  const repo: FavoritesRepositoryLike & { insertCalls: number } = {
    insertCalls: 0,
    async listSummariesByUser(userId) {
      const rows: FavoriteListSummaryRow[] = [...lists.values()]
        .filter((l) => l.userId === userId)
        .map((l) => ({
          ...l,
          itemCount: [...items.values()].filter((i) => i.listId === l.id).length,
        }));
      // default first, then newest (mirrors the SQL ORDER BY)
      return rows.sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    },
    async findListById(listId) {
      const row = lists.get(listId);
      return row ? { ...row } : null;
    },
    async findDefaultList(userId) {
      const row = [...lists.values()].find((l) => l.userId === userId && l.isDefault);
      return row ? { ...row } : null;
    },
    async countListsByUser(userId) {
      return [...lists.values()].filter((l) => l.userId === userId).length;
    },
    async insertList(input) {
      repo.insertCalls++;
      if ([...lists.values()].some((l) => l.userId === input.userId && l.name === input.name)) {
        return null; // (user_id, name) unique index
      }
      if (
        input.isDefault &&
        [...lists.values()].some((l) => l.userId === input.userId && l.isDefault)
      ) {
        return null; // one-default-per-user partial unique index
      }
      const row: FavoriteListMeta = {
        id: nextId(),
        userId: input.userId,
        name: input.name,
        isDefault: input.isDefault,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      lists.set(row.id, row);
      return { ...row };
    },
    async renameList(listId, name) {
      const row = lists.get(listId);
      if (row) {
        row.name = name;
        row.updatedAt = new Date();
      }
    },
    async deleteList(listId) {
      for (const [id, item] of [...items]) if (item.listId === listId) items.delete(id);
      lists.delete(listId);
    },
    async insertItem(input) {
      if (
        [...items.values()].some(
          (i) => i.userId === input.userId && i.businessId === input.businessId,
        )
      ) {
        return null; // favorite_items_one_per_user unique index
      }
      const row = {
        id: nextId(),
        userId: input.userId,
        listId: input.listId,
        businessId: input.businessId,
        note: input.note,
        // every INSERT gets its own now() — a strictly increasing clock so
        // the DESC ordering (and its id tiebreak) is deterministic here too
        createdAt: new Date(1_700_000_000_000 + items.size * 1_000),
      };
      items.set(row.id, row);
      return { ...row };
    },
    async findItemById(itemId) {
      const row = items.get(itemId);
      return row ? { ...row } : null;
    },
    async findItemByUserAndBusiness(userId, businessId) {
      const row = [...items.values()].find(
        (i) => i.userId === userId && i.businessId === businessId,
      );
      if (!row) return null;
      const list = lists.get(row.listId);
      return { ...row, listName: list?.name ?? '' } satisfies FavoriteItemWithContext;
    },
    async countItemsInList(listId) {
      return [...items.values()].filter((i) => i.listId === listId).length;
    },
    async listItemRows(listId, page, pageSize) {
      const rows = [...items.values()]
        .filter((i) => i.listId === listId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        rows: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r })),
        total: rows.length,
      };
    },
    async updateItem(itemId, patch) {
      const row = items.get(itemId);
      if (!row) return;
      if (patch.listId !== undefined) row.listId = patch.listId;
      if (patch.note !== undefined) row.note = patch.note;
    },
    async deleteItem(itemId) {
      items.delete(itemId);
    },
    async findBusinessContext(businessId) {
      return biz.get(businessId) ?? null;
    },
  };
  return { repo, lists, items };
}

/** Business-cards fake backing findSummariesByIds (B2.4 contract). */
function makeBusinesses() {
  const cards = new Map<string, BusinessSummary>([
    [BIZ, businessCard(BIZ)],
    [BIZ2, businessCard(BIZ2)],
  ]);
  return {
    async findSummariesByIds(ids: string[]) {
      return ids.filter((id) => cards.has(id)).map((id) => cards.get(id) as BusinessSummary);
    },
  } as never; // the narrow slice FavoritesService consumes
}

function makeService(initialLists: FavoriteListMeta[] = []) {
  const { repo, lists, items } = makeRepo(initialLists);
  const events = { emitted: [] as Array<{ name: string; payload: unknown }> };
  const emitter = {
    emit(name: string, payload: unknown) {
      events.emitted.push({ name, payload });
    },
  } as unknown as EventEmitter2;
  const service = new FavoritesService(repo, makeBusinesses(), emitter);
  return { service, repo, lists, items, events };
}

async function httpStatus(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  throw new Error('expected the call to throw an HttpException');
}

describe('FavoritesService — B5.1', () => {
  // ─── reads ─────────────────────────────────────────────────────────────

  it('listMine returns the lists with counts, default first, ISO dates', async () => {
    const { service } = makeService([
      listRow({ id: LIST_A, name: 'کافه‌های تهران' }),
      listRow({
        id: DEFAULT_LIST,
        name: FAVORITE_DEFAULT_LIST_NAME,
        isDefault: true,
        createdAt: new Date('2026-11-10T09:00:00Z'),
      }),
    ]);
    const result = await service.listMine(USER.id);
    expect(result.lists).toHaveLength(2);
    expect(result.lists[0]!.isDefault).toBe(true);
    expect(result.lists[1]!.id).toBe(LIST_A);
    for (const list of result.lists) {
      expect(list.createdAt).toBe(new Date(list.createdAt).toISOString());
      expect(list.updatedAt).toBe(new Date(list.updatedAt).toISOString());
    }
  });

  it('status answers favorited:false with nulls when the business is not saved', async () => {
    const { service } = makeService();
    const result = await service.status(USER.id, BIZ);
    expect(result).toEqual({
      businessId: BIZ,
      favorited: false,
      listId: null,
      listName: null,
      itemId: null,
    });
  });

  it('status probes one (user, business) row and carries the holding list', async () => {
    const { service } = makeService([listRow({ id: LIST_A, name: 'کافه‌های تهران' })]);
    await service.addItem(LIST_A, USER, { businessId: BIZ });
    const result = await service.status(USER.id, BIZ);
    expect(result.favorited).toBe(true);
    expect(result.listId).toBe(LIST_A);
    expect(result.listName).toBe('کافه‌های تهران');
    expect(result.itemId).toBeTypeOf('string');
    // and a stranger sees nothing of it
    const strangerView = await service.status(STRANGER.id, BIZ);
    expect(strangerView.favorited).toBe(false);
  });

  // ─── named lists ───────────────────────────────────────────────────────

  it('createList inserts a named list with zero items and emits list.created', async () => {
    const { service, events } = makeService();
    const list = await service.createList(USER.id, { name: ' نانوایی‌های شمال ' });
    expect(list.name).toBe(' نانوایی‌های شمال ');
    expect(list.isDefault).toBe(false);
    expect(list.itemCount).toBe(0);
    expect(events.emitted).toContainEqual({
      name: FAVORITES_EVENTS.listCreated,
      payload: { userId: USER.id, listId: list.id, name: ' نانوایی‌های شمال ' },
    });
  });

  it('createList refuses the reserved default name (422) and duplicate names (409)', async () => {
    const { service } = makeService();
    expect(
      await httpStatus(() => service.createList(USER.id, { name: FAVORITE_DEFAULT_LIST_NAME })),
    ).toBe(422);
    await service.createList(USER.id, { name: 'دوست‌داشتنی‌ها' });
    expect(await httpStatus(() => service.createList(USER.id, { name: 'دوست‌داشتنی‌ها' }))).toBe(
      409,
    );
  });

  it('createList hits the per-user cap (422)', async () => {
    const seed = Array.from({ length: FAVORITE_MAX_LISTS_PER_USER }, (_, i) =>
      listRow({
        id: `6${String(i).padStart(7, '0')}-6161-4611-8161-616161616161`,
        name: `لیست ${i}`,
      }),
    );
    const { service } = makeService(seed);
    expect(await httpStatus(() => service.createList(USER.id, { name: 'یکی دیگر' }))).toBe(422);
  });

  it('renameList renames an own list and re-counts; foreign/missing lists 404', async () => {
    const { service } = makeService([listRow({ id: LIST_A, name: 'قدیمی' })]);
    const renamed = await service.renameList(LIST_A, USER, { name: 'تازه' });
    expect(renamed.name).toBe('تازه');
    expect(renamed.itemCount).toBe(0);
    expect(await httpStatus(() => service.renameList(LIST_A, STRANGER, { name: 'x' }))).toBe(404);
    expect(
      await httpStatus(() =>
        service.renameList('71717171-7171-4717-8717-717171717171', USER, { name: 'x' }),
      ),
    ).toBe(404);
  });

  it('renameList answers 409 when a sibling already owns the name', async () => {
    const { service } = makeService([
      listRow({ id: LIST_A, name: 'الف' }),
      listRow({ id: LIST_B, name: 'ب' }),
    ]);
    expect(await httpStatus(() => service.renameList(LIST_A, USER, { name: 'ب' }))).toBe(409);
    // renaming to your own current name is a no-op, not a conflict
    const same = await service.renameList(LIST_A, USER, { name: 'الف' });
    expect(same.name).toBe('الف');
  });

  it('deleteList removes a named list (and its items) but refuses the default list (422)', async () => {
    const { service, events, items } = makeService([
      listRow({ id: LIST_A, name: 'کافه‌ها' }),
      listRow({ id: DEFAULT_LIST, name: FAVORITE_DEFAULT_LIST_NAME, isDefault: true }),
    ]);
    const item = await service.addItem(LIST_A, USER, { businessId: BIZ });
    events.emitted.length = 0;
    expect(await httpStatus(() => service.deleteList(DEFAULT_LIST, USER))).toBe(422);
    const result = await service.deleteList(LIST_A, USER);
    expect(result).toEqual({ deleted: true });
    expect(items.has(item.id)).toBe(false);
    // every cascaded item announced BEFORE the delete event
    const names = events.emitted.map((e) => e.name);
    expect(names).toEqual([FAVORITES_EVENTS.removed, FAVORITES_EVENTS.listDeleted]);
    expect(events.emitted[0]!.payload).toMatchObject({
      userId: USER.id,
      businessId: BIZ,
      listId: LIST_A,
    });
  });

  it('deleteList is owner-only (404-never-leak)', async () => {
    const { service } = makeService([listRow({ id: LIST_A })]);
    expect(await httpStatus(() => service.deleteList(LIST_A, STRANGER))).toBe(404);
  });

  // ─── items ─────────────────────────────────────────────────────────────

  it('addItem saves an active business and emits favorite.added with the payload consumers need', async () => {
    const { service, events } = makeService([listRow({ id: LIST_A })]);
    const item = await service.addItem(LIST_A, USER, {
      businessId: BIZ,
      note: 'دوشنبه‌ها بسته است',
    });
    expect(item.listId).toBe(LIST_A);
    expect(item.note).toBe('دوشنبه‌ها بسته است');
    expect(events.emitted).toContainEqual({
      name: FAVORITES_EVENTS.added,
      payload: { userId: USER.id, businessId: BIZ, listId: LIST_A, itemId: item.id },
    });
  });

  it('addItem 404s a missing/deleted business and 422s a non-active one', async () => {
    const { service } = makeService([listRow({ id: LIST_A })]);
    expect(
      await httpStatus(() =>
        service.addItem(LIST_A, USER, { businessId: '72727272-7272-4727-8727-727272727272' }),
      ),
    ).toBe(404);
    expect(await httpStatus(() => service.addItem(LIST_A, USER, { businessId: DELETED_BIZ }))).toBe(
      404,
    );
    expect(await httpStatus(() => service.addItem(LIST_A, USER, { businessId: PENDING_BIZ }))).toBe(
      422,
    );
  });

  it('addItem is one-list-per-(user,business): a second save anywhere is 409', async () => {
    const { service } = makeService([listRow({ id: LIST_A }), listRow({ id: LIST_B })]);
    await service.addItem(LIST_A, USER, { businessId: BIZ });
    expect(await httpStatus(() => service.addItem(LIST_B, USER, { businessId: BIZ }))).toBe(409);
    // and the same business for a DIFFERENT user (owning their own list) is fine
    const other = makeService([listRow({ id: LIST_B, userId: STRANGER.id })]);
    await expect(
      other.service.addItem(LIST_B, STRANGER, { businessId: BIZ }),
    ).resolves.toMatchObject({ businessId: BIZ });
  });

  it('addItem refuses a full list (422) and a foreign list (404)', async () => {
    const seed: FavoriteListMeta[] = [listRow({ id: LIST_A })];
    const { repo, service } = makeService(seed);
    vi.spyOn(repo, 'countItemsInList').mockResolvedValue(FAVORITE_MAX_ITEMS_PER_LIST);
    expect(await httpStatus(() => service.addItem(LIST_A, USER, { businessId: BIZ }))).toBe(422);
    vi.restoreAllMocks();
    expect(await httpStatus(() => service.addItem(LIST_A, STRANGER, { businessId: BIZ }))).toBe(
      404,
    );
  });

  it('addToDefault lazily creates the default list on the first write, then reuses it', async () => {
    const { service, repo, lists } = makeService();
    const first = await service.addToDefault(USER, { businessId: BIZ });
    expect(first.listId).toBeTypeOf('string');
    const def = await repo.findDefaultList(USER.id);
    expect(def?.name).toBe(FAVORITE_DEFAULT_LIST_NAME);
    expect(def?.isDefault).toBe(true);
    expect(lists.size).toBe(1);
    const second = await service.addToDefault(USER, { businessId: BIZ2 });
    expect(second.listId).toBe(first.listId);
    expect(repo.insertCalls).toBe(1); // the default list is created exactly once
  });

  it('listItems joins the B2.4 cards in row order and pages with meta', async () => {
    const { service } = makeService([listRow({ id: LIST_A })]);
    await service.addItem(LIST_A, USER, { businessId: BIZ2, note: 'دوم' });
    await service.addItem(LIST_A, USER, { businessId: BIZ, note: 'اول' });
    const page1 = await service.listItems(LIST_A, USER, { page: 1, pageSize: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]!.business.id).toBe(BIZ); // newest first
    expect(page1.items[0]!.note).toBe('اول');
    expect(page1.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    const page2 = await service.listItems(LIST_A, USER, { page: 2, pageSize: 1 });
    expect(page2.items[0]!.business.id).toBe(BIZ2);
    expect(
      await httpStatus(() => service.listItems(LIST_A, STRANGER, { page: 1, pageSize: 20 })),
    ).toBe(404);
  });

  it('updateItem moves an item between own lists and sets/clears the note', async () => {
    const { service } = makeService([listRow({ id: LIST_A }), listRow({ id: LIST_B })]);
    const item = await service.addItem(LIST_A, USER, { businessId: BIZ, note: 'یادداشت' });
    const moved = await service.updateItem(item.id, USER, { listId: LIST_B, note: null });
    expect(moved.listId).toBe(LIST_B);
    expect(moved.note).toBeNull();
    const noted = await service.updateItem(item.id, USER, { note: 'تازه' });
    expect(noted.note).toBe('تازه');
  });

  it('updateItem refuses a full target list (422) and foreign/missing items (404)', async () => {
    const { repo, service } = makeService([listRow({ id: LIST_A }), listRow({ id: LIST_B })]);
    const item = await service.addItem(LIST_A, USER, { businessId: BIZ });
    vi.spyOn(repo, 'countItemsInList').mockResolvedValue(FAVORITE_MAX_ITEMS_PER_LIST);
    expect(await httpStatus(() => service.updateItem(item.id, USER, { listId: LIST_B }))).toBe(422);
    vi.restoreAllMocks();
    expect(await httpStatus(() => service.updateItem(item.id, STRANGER, { note: 'x' }))).toBe(404);
    expect(
      await httpStatus(() =>
        service.updateItem('73737373-7373-4737-8737-737373737373', USER, { note: 'x' }),
      ),
    ).toBe(404);
  });

  it('removeItem deletes and emits favorite.removed; foreign/missing items 404', async () => {
    const { service, events, items } = makeService([listRow({ id: LIST_A })]);
    const item = await service.addItem(LIST_A, USER, { businessId: BIZ });
    events.emitted.length = 0;
    expect(await httpStatus(() => service.removeItem(item.id, STRANGER))).toBe(404);
    const result = await service.removeItem(item.id, USER);
    expect(result).toEqual({ deleted: true });
    expect(items.has(item.id)).toBe(false);
    expect(events.emitted).toEqual([
      {
        name: FAVORITES_EVENTS.removed,
        payload: { userId: USER.id, businessId: BIZ, listId: LIST_A, itemId: item.id },
      },
    ]);
  });
});
