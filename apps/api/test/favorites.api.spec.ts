import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AUDIT_SERVICE } from '../src/modules/audit/audit.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { BUSINESSES_REPOSITORY } from '../src/modules/business/businesses.repository.js';
import { FAVORITES_REPOSITORY } from '../src/modules/favorites/favorites.repository.js';
import { FAVORITE_DEFAULT_LIST_NAME } from '@app/contracts';
import { FakeRedis } from './fake-redis.js';
import {
  createUser,
  loginAs,
  makeMemorySessionRepo,
  makeMemoryUserRepo,
  type LoginSession,
} from './auth.utils.js';

/**
 * HTTP-level favorites tests (B5.1) WITHOUT live services: Redis is
 * FakeRedis, the user/session repositories are in-memory fakes, the
 * favorites repository is an in-memory fake (the real SQL needs Postgres —
 * Docker follow-up), the businesses repository is a card-returning fake,
 * the audit service is a capturing spy. The REAL controllers, guards
 * (RateLimit → JwtAuth → CsrfOrigin), envelope and exception filter all run
 * for real here — favorites has no @Public route, so every anonymous call
 * must answer 401.
 */

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const PENDING = '12121212-1212-4212-8212-121212121212';
const DELETED = '13131313-1313-4313-8313-131313131313';
const MISSING = '14141414-1414-4414-8414-141414141414';

/** The card each favorites list-item read joins (a BusinessSummary slice). */
function cardFor(id: string) {
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

interface FakeListRow {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeItemRow {
  id: string;
  userId: string;
  listId: string;
  businessId: string;
  note: string | null;
  createdAt: Date;
}

/** In-memory favorites repo mirroring the SQL semantics (see the service spec). */
function makeMemoryFavoritesRepo() {
  const lists = new Map<string, FakeListRow>();
  const items = new Map<string, FakeItemRow>();
  const biz = new Map<string, { status: string; deletedAt: Date | null }>([
    [ACTIVE, { status: 'active', deletedAt: null }],
    [PENDING, { status: 'pending', deletedAt: null }],
    [DELETED, { status: 'active', deletedAt: new Date() }],
  ]);
  let seq = 0;
  const nextId = () => `9${String(++seq).padStart(7, '0')}-9999-4999-8999-999999999999`;
  return {
    lists,
    items,
    async listSummariesByUser(userId: string) {
      return [...lists.values()]
        .filter((l) => l.userId === userId)
        .map((l) => ({
          ...l,
          itemCount: [...items.values()].filter((i) => i.listId === l.id).length,
        }))
        .sort(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );
    },
    async findListById(listId: string) {
      const row = lists.get(listId);
      return row ? { ...row } : null;
    },
    async findDefaultList(userId: string) {
      const row = [...lists.values()].find((l) => l.userId === userId && l.isDefault);
      return row ? { ...row } : null;
    },
    async countListsByUser(userId: string) {
      return [...lists.values()].filter((l) => l.userId === userId).length;
    },
    async insertList(input: { userId: string; name: string; isDefault: boolean }) {
      if (
        [...lists.values()].some(
          (l) =>
            l.userId === input.userId &&
            l.name === input.name &&
            // the one-default-per-user partial index only fires for defaults
            (l.name !== FAVORITE_DEFAULT_LIST_NAME || input.isDefault || l.isDefault),
        )
      ) {
        return null;
      }
      if (
        input.isDefault &&
        [...lists.values()].some((l) => l.userId === input.userId && l.isDefault)
      ) {
        return null;
      }
      const row: FakeListRow = {
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
    async renameList(listId: string, name: string) {
      const row = lists.get(listId);
      if (row) {
        row.name = name;
        row.updatedAt = new Date();
      }
    },
    async deleteList(listId: string) {
      for (const [id, item] of [...items]) if (item.listId === listId) items.delete(id);
      lists.delete(listId);
    },
    async insertItem(input: {
      userId: string;
      listId: string;
      businessId: string;
      note: string | null;
    }) {
      if (
        [...items.values()].some(
          (i) => i.userId === input.userId && i.businessId === input.businessId,
        )
      ) {
        return null;
      }
      const row: FakeItemRow = {
        id: nextId(),
        userId: input.userId,
        listId: input.listId,
        businessId: input.businessId,
        note: input.note,
        createdAt: new Date(1_700_000_000_000 + items.size * 1_000),
      };
      items.set(row.id, row);
      return { ...row };
    },
    async findItemById(itemId: string) {
      const row = items.get(itemId);
      return row ? { ...row } : null;
    },
    async findItemByUserAndBusiness(userId: string, businessId: string) {
      const row = [...items.values()].find(
        (i) => i.userId === userId && i.businessId === businessId,
      );
      if (!row) return null;
      return { ...row, listName: lists.get(row.listId)?.name ?? '' };
    },
    async countItemsInList(listId: string) {
      return [...items.values()].filter((i) => i.listId === listId).length;
    },
    async listItemRows(listId: string, page: number, pageSize: number) {
      const rows = [...items.values()]
        .filter((i) => i.listId === listId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        rows: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r })),
        total: rows.length,
      };
    },
    async updateItem(itemId: string, patch: { listId?: string; note?: string | null }) {
      const row = items.get(itemId);
      if (!row) return;
      if (patch.listId !== undefined) row.listId = patch.listId;
      if (patch.note !== undefined) row.note = patch.note;
    },
    async deleteItem(itemId: string) {
      items.delete(itemId);
    },
    async findBusinessContext(businessId: string) {
      return biz.get(businessId) ?? null;
    },
  };
}

type FavoritesRepoFake = ReturnType<typeof makeMemoryFavoritesRepo>;

function makeFakeSettingsRepo() {
  const store = new Map<
    string,
    { key: string; value: unknown; isSecret: boolean; group: string }
  >();
  return {
    store,
    async findAll() {
      return [...store.values()].map((r) => ({ ...r, description: null }));
    },
    async findByKey(key: string) {
      const row = store.get(key);
      return row ? { ...row, description: null } : null;
    },
    async upsert(row: { key: string; value: unknown; isSecret: boolean; group: string }) {
      const created = { ...row, description: null, updatedAt: new Date() };
      store.set(row.key, created);
      return created;
    },
  };
}

let app: INestApplication;
let favRepo: FavoritesRepoFake;
const auditActions: string[] = [];
let user: LoginSession;
let stranger: LoginSession;

beforeAll(async () => {
  const redis = new FakeRedis();
  favRepo = makeMemoryFavoritesRepo();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined), route: vi.fn() })
    .overrideProvider(FAVORITES_REPOSITORY)
    .useValue(favRepo)
    .overrideProvider(BUSINESSES_REPOSITORY)
    .useValue({
      async findSummariesByIds(ids: string[]) {
        return ids.filter((id) => id === ACTIVE).map((id) => cardFor(id));
      },
    })
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(makeFakeSettingsRepo())
    .overrideProvider(AUDIT_SERVICE)
    .useValue({
      log: (entry: { action: string }) => {
        auditActions.push(entry.action);
      },
      write: vi.fn(async () => ({ id: 'audit-1' })),
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();

  await createUser(app, { username: 'favuser', password: 'Sup3rSecret!2026' });
  await createUser(app, { username: 'favstranger', password: 'Sup3rSecret!2026' });
  user = await loginAs(app, 'favuser', 'Sup3rSecret!2026');
  stranger = await loginAs(app, 'favstranger', 'Sup3rSecret!2026');
});

afterAll(async () => {
  await app?.close();
});

const getMine = (bearer?: string) =>
  request(app.getHttpServer())
    .get('/api/v1/favorites/me')
    .set(bearer ? { Authorization: bearer } : {});

const checkStatus = (businessId: string, bearer: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/favorites/me/check?businessId=${businessId}`)
    .set({ Authorization: bearer });

const addDefault = (body: object, bearer: string) =>
  request(app.getHttpServer())
    .post('/api/v1/favorites/items')
    .set({ Authorization: bearer })
    .send(body);

const addToList = (listId: string, body: object, bearer: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/favorites/lists/${listId}/items`)
    .set({ Authorization: bearer })
    .send(body);

const createList = (body: object, bearer: string) =>
  request(app.getHttpServer())
    .post('/api/v1/favorites/lists')
    .set({ Authorization: bearer })
    .send(body);

const renameList = (listId: string, body: object, bearer: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/favorites/lists/${listId}`)
    .set({ Authorization: bearer })
    .send(body);

const deleteList = (listId: string, bearer: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/favorites/lists/${listId}`)
    .set({ Authorization: bearer });

const listItems = (listId: string, query = '', bearer = user.bearer) =>
  request(app.getHttpServer())
    .get(`/api/v1/favorites/lists/${listId}/items${query}`)
    .set({ Authorization: bearer });

const patchItem = (itemId: string, body: object, bearer: string) =>
  request(app.getHttpServer())
    .patch(`/api/v1/favorites/items/${itemId}`)
    .set({ Authorization: bearer })
    .send(body);

const deleteItem = (itemId: string, bearer: string) =>
  request(app.getHttpServer())
    .delete(`/api/v1/favorites/items/${itemId}`)
    .set({ Authorization: bearer });

describe('Favorites HTTP — B5.1', () => {
  it('401s every favorites route without a bearer (no @Public routes here)', async () => {
    const mine = await getMine();
    expect(mine.status).toBe(401);
    expect(mine.body.ok).toBe(false);
    const check = await request(app.getHttpServer()).get(
      `/api/v1/favorites/me/check?businessId=${ACTIVE}`,
    );
    expect(check.status).toBe(401);
    const add = await request(app.getHttpServer())
      .post('/api/v1/favorites/items')
      .send({ businessId: ACTIVE });
    expect(add.status).toBe(401);
  });

  it('GET /favorites/me starts empty — a read NEVER creates the default list', async () => {
    const res = await getMine(user.bearer);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.lists).toEqual([]);
    expect(favRepo.lists.size).toBe(0);
  });

  it('the heart-on POST lazily creates the default list and the read reflects it', async () => {
    const add = await addDefault({ businessId: ACTIVE, note: 'کافه کتاب' }, user.bearer);
    expect(add.status).toBe(201);
    expect(add.body.ok).toBe(true);
    expect(add.body.data.note).toBe('کافه کتاب');

    const mine = await getMine(user.bearer);
    expect(mine.body.data.lists).toHaveLength(1);
    expect(mine.body.data.lists[0]).toMatchObject({
      name: FAVORITE_DEFAULT_LIST_NAME,
      isDefault: true,
      itemCount: 1,
    });

    const status = await checkStatus(ACTIVE, user.bearer);
    expect(status.body.data).toMatchObject({
      businessId: ACTIVE,
      favorited: true,
      listName: FAVORITE_DEFAULT_LIST_NAME,
    });
    expect(status.body.data.listId).toBe(add.body.data.listId);
  });

  it('a second heart-on for the same business is 409 (one list per user+business)', async () => {
    const res = await addDefault({ businessId: ACTIVE }, user.bearer);
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.messageKey).toBe('errors.conflict');
  });

  it('heart-on 404s a missing/deleted business and 422s a non-active one', async () => {
    const missing = await addDefault({ businessId: MISSING }, user.bearer);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const deleted = await addDefault({ businessId: DELETED }, user.bearer);
    expect(deleted.status).toBe(404);

    const pending = await addDefault({ businessId: PENDING }, user.bearer);
    expect(pending.status).toBe(422);
    expect(pending.body.error.code).toBe('UNPROCESSABLE');
  });

  it('a garbage businessId in the body answers 400 before any DB touch', async () => {
    // body schemas are validated by the ZodValidationPipe (400); only PATH
    // params go through the controller's assertUuid (422)
    const res = await addDefault({ businessId: 'not-a-uuid' }, user.bearer);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('named lists: create → add → cards page → rename → delete; the default list is undeletable', async () => {
    const created = await createList({ name: 'کافه‌های تهران' }, user.bearer);
    expect(created.status).toBe(201);
    const listId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      name: 'کافه‌های تهران',
      isDefault: false,
      itemCount: 0,
    });

    // reserved default name + duplicate name
    const reserved = await createList({ name: FAVORITE_DEFAULT_LIST_NAME }, user.bearer);
    expect(reserved.status).toBe(422);
    const duplicate = await createList({ name: 'کافه‌های تهران' }, user.bearer);
    expect(duplicate.status).toBe(409);

    // saving a SECOND business into the named list (the first one sits in the default list)
    const added = await addToList(listId, { businessId: PENDING }, user.bearer);
    expect(added.status).toBe(422); // pending is not active — use ACTIVE for the stranger's flow instead
    const okAdd = await addToList(listId, { businessId: ACTIVE }, user.bearer);
    expect(okAdd.status).toBe(409); // ACTIVE is already in the user's DEFAULT list → 409

    // the stranger saves ACTIVE into THEIR named list fine (per-user invariant)
    const sList = await createList({ name: 'لیست غریبه' }, stranger.bearer);
    const sAdd = await addToList(sList.body.data.id, { businessId: ACTIVE }, stranger.bearer);
    expect(sAdd.status).toBe(201);

    // cards page (own list): the stranger's list now has ACTIVE with a full card
    const page = await listItems(sList.body.data.id);
    expect(page.status).toBe(404); // stranger's list is INVISIBLE to `user` — 404-never-leak
    const ownPage = await listItems(listId, '?page=1&pageSize=10');
    expect(ownPage.status).toBe(200);
    expect(ownPage.body.data.items).toEqual([]); // the 409 kept the list empty

    // the stranger's own page shows the card
    const strangerPage = await listItems(
      sList.body.data.id,
      '?page=1&pageSize=10',
      stranger.bearer,
    );
    expect(strangerPage.status).toBe(200);
    expect(strangerPage.body.data.meta).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(strangerPage.body.data.items[0].business).toMatchObject({
      id: ACTIVE,
      name: 'کافه نمونه',
    });

    // rename
    const renamed = await renameList(listId, { name: 'قهوه' }, user.bearer);
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('قهوه');

    // default list cannot be deleted — find it via /me
    const mine = await getMine(user.bearer);
    const def = mine.body.data.lists.find((l: { isDefault: boolean }) => l.isDefault);
    const delDefault = await deleteList(def.id, user.bearer);
    expect(delDefault.status).toBe(422);
    expect(delDefault.body.error.details).toMatchObject({ reason: 'default_list' });

    // deleting the named list cascades its (empty) contents and 404s afterwards
    const del = await deleteList(listId, user.bearer);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true });
    const gone = await listItems(listId);
    expect(gone.status).toBe(404);
  });

  it('PATCH /favorites/items/:id moves an item between own lists; foreign ids 404', async () => {
    const listA = await createList({ name: 'مقصد الف' }, user.bearer);
    const listB = await createList({ name: 'مقصد ب' }, user.bearer);
    // ACTIVE sits in the default list — move it to مقصد الف
    const mine = await getMine(user.bearer);
    const def = mine.body.data.lists.find((l: { isDefault: boolean }) => l.isDefault);
    const defItems = await listItems(def.id, '?page=1&pageSize=10');
    const item = defItems.body.data.items[0];
    expect(item.business.id).toBe(ACTIVE);

    const moved = await patchItem(
      item.id,
      { listId: listA.body.data.id, note: 'جابه‌جا شد' },
      user.bearer,
    );
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ listId: listA.body.data.id, note: 'جابه‌جا شد' });

    const check = await checkStatus(ACTIVE, user.bearer);
    expect(check.body.data.listId).toBe(listA.body.data.id);

    // a stranger cannot touch (or even discover) it
    const foreign = await patchItem(item.id, { note: 'hack' }, stranger.bearer);
    expect(foreign.status).toBe(404);

    // heart-off via DELETE
    const removed = await deleteItem(item.id, user.bearer);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ deleted: true });
    const after = await checkStatus(ACTIVE, user.bearer);
    expect(after.body.data.favorited).toBe(false);
    void listB;
  });

  it('writes are audited with the favorites action names', async () => {
    expect(auditActions).toContain('favorite.add');
    expect(auditActions).toContain('favorite.list.create');
    expect(auditActions).toContain('favorite.list.update');
    expect(auditActions).toContain('favorite.item.update');
    expect(auditActions).toContain('favorite.remove');
    expect(auditActions).toContain('favorite.list.delete');
  });
});
