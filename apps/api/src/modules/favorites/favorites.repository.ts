import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { favoriteItems, favoriteLists } from '../../db/schema/favorites.js';

/** DI token for the favorites repository (tests bind a fake). */
export const FAVORITES_REPOSITORY = Symbol('FAVORITES_REPOSITORY');

/** A list row as every list-level read serves it (owner checks + DTO mapping). */
export interface FavoriteListMeta {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A list summary joined with its item count (GET /favorites/me). */
export interface FavoriteListSummaryRow extends FavoriteListMeta {
  itemCount: number;
}

/** A saved-item row (the raw storage shape the service maps into DTOs). */
export interface FavoriteItemMeta {
  id: string;
  userId: string;
  listId: string;
  businessId: string;
  note: string | null;
  createdAt: Date;
}

/** The heart probe: the item + the list it currently sits in. */
export interface FavoriteItemWithContext extends FavoriteItemMeta {
  listName: string;
}

/** A page of saved-item rows (the card join happens in the service). */
export interface FavoriteItemPage {
  rows: FavoriteItemMeta[];
  total: number;
}

/**
 * The narrow fake-able surface consumed by FavoritesService + the HTTP
 * layer. Uniqueness races (23505 on `favorite_items_one_per_user`,
 * `favorite_lists_user_name_unq`, `favorite_lists_one_default_per_user`)
 * are mapped to `null` HERE so the service can answer a clean 409 without
 * importing pg error internals.
 */
export interface FavoritesRepositoryLike {
  /** All of the user's lists + item counts (default first, then newest). */
  listSummariesByUser(userId: string): Promise<FavoriteListSummaryRow[]>;
  findListById(listId: string): Promise<FavoriteListMeta | null>;
  findDefaultList(userId: string): Promise<FavoriteListMeta | null>;
  countListsByUser(userId: string): Promise<number>;
  /** Returns null when a per-user unique index rejects the insert. */
  insertList(input: {
    userId: string;
    name: string;
    isDefault: boolean;
  }): Promise<FavoriteListMeta | null>;
  /** Stamp + rename in one statement (the service re-counts for the summary). */
  renameList(listId: string, name: string): Promise<void>;
  deleteList(listId: string): Promise<void>;
  insertItem(input: {
    userId: string;
    listId: string;
    businessId: string;
    note: string | null;
  }): Promise<FavoriteItemMeta | null>;
  findItemById(itemId: string): Promise<FavoriteItemMeta | null>;
  /** The one-indexed-probe heart state (item + holding list's name). */
  findItemByUserAndBusiness(
    userId: string,
    businessId: string,
  ): Promise<FavoriteItemWithContext | null>;
  countItemsInList(listId: string): Promise<number>;
  /** Newest-first page over one list (id is the stable tiebreak). */
  listItemRows(listId: string, page: number, pageSize: number): Promise<FavoriteItemPage>;
  /** Move between lists and/or set the note (`note === null` clears it). */
  updateItem(itemId: string, patch: { listId?: string; note?: string | null }): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  /** Existence + lifecycle of the business (404-never-leak rule, mirrors QA). */
  findBusinessContext(businessId: string): Promise<{
    status: string;
    deletedAt: Date | null;
  } | null>;
}

@Injectable()
export class FavoritesRepository implements FavoritesRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async listSummariesByUser(userId: string): Promise<FavoriteListSummaryRow[]> {
    const rows = await this.client.db
      .select({
        id: favoriteLists.id,
        userId: favoriteLists.userId,
        name: favoriteLists.name,
        isDefault: favoriteLists.isDefault,
        createdAt: favoriteLists.createdAt,
        updatedAt: favoriteLists.updatedAt,
        itemCount: count(favoriteItems.id),
      })
      .from(favoriteLists)
      .leftJoin(favoriteItems, eq(favoriteItems.listId, favoriteLists.id))
      .where(eq(favoriteLists.userId, userId))
      .groupBy(favoriteLists.id)
      // DESC on a boolean puts `true` first → the default list leads; the
      // id tiebreak keeps the page stable across equal timestamps.
      .orderBy(desc(favoriteLists.isDefault), desc(favoriteLists.createdAt), asc(favoriteLists.id));
    return rows.map((r) => ({ ...r, itemCount: Number(r.itemCount) }));
  }

  async findListById(listId: string): Promise<FavoriteListMeta | null> {
    return this.findList(eq(favoriteLists.id, listId));
  }

  async findDefaultList(userId: string): Promise<FavoriteListMeta | null> {
    // `and()` types as SQL | undefined; both eq() operands are definite so
    // the combined predicate is always a real SQL node.
    return this.findList(
      and(eq(favoriteLists.userId, userId), eq(favoriteLists.isDefault, true)) as SQL,
    );
  }

  async countListsByUser(userId: string): Promise<number> {
    const rows = await this.client.db
      .select({ value: count() })
      .from(favoriteLists)
      .where(eq(favoriteLists.userId, userId));
    return Number(rows[0]?.value ?? 0);
  }

  async insertList(input: {
    userId: string;
    name: string;
    isDefault: boolean;
  }): Promise<FavoriteListMeta | null> {
    try {
      const rows = await this.client.db
        .insert(favoriteLists)
        .values({ userId: input.userId, name: input.name, isDefault: input.isDefault })
        .returning({
          id: favoriteLists.id,
          userId: favoriteLists.userId,
          name: favoriteLists.name,
          isDefault: favoriteLists.isDefault,
          createdAt: favoriteLists.createdAt,
          updatedAt: favoriteLists.updatedAt,
        });
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // unique race → 409 upstream
      throw error;
    }
  }

  async renameList(listId: string, name: string): Promise<void> {
    // The service pre-checks the sibling-name conflict (409); this write can
    // still lose a last-write race to the (user_id, name) unique index, which
    // then surfaces as a plain duplicate-key error — acceptable, the race
    // window is one request.
    await this.client.db
      .update(favoriteLists)
      .set({ name, updatedAt: new Date() })
      .where(eq(favoriteLists.id, listId));
  }

  async deleteList(listId: string): Promise<void> {
    await this.client.db.delete(favoriteLists).where(eq(favoriteLists.id, listId));
  }

  async insertItem(input: {
    userId: string;
    listId: string;
    businessId: string;
    note: string | null;
  }): Promise<FavoriteItemMeta | null> {
    try {
      const rows = await this.client.db
        .insert(favoriteItems)
        .values({
          userId: input.userId,
          listId: input.listId,
          businessId: input.businessId,
          note: input.note,
        })
        .returning({
          id: favoriteItems.id,
          userId: favoriteItems.userId,
          listId: favoriteItems.listId,
          businessId: favoriteItems.businessId,
          note: favoriteItems.note,
          createdAt: favoriteItems.createdAt,
        });
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // already favorited → 409 upstream
      throw error;
    }
  }

  async findItemById(itemId: string): Promise<FavoriteItemMeta | null> {
    const rows = await this.client.db
      .select({
        id: favoriteItems.id,
        userId: favoriteItems.userId,
        listId: favoriteItems.listId,
        businessId: favoriteItems.businessId,
        note: favoriteItems.note,
        createdAt: favoriteItems.createdAt,
      })
      .from(favoriteItems)
      .where(eq(favoriteItems.id, itemId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findItemByUserAndBusiness(
    userId: string,
    businessId: string,
  ): Promise<FavoriteItemWithContext | null> {
    const rows = await this.client.db
      .select({
        id: favoriteItems.id,
        userId: favoriteItems.userId,
        listId: favoriteItems.listId,
        businessId: favoriteItems.businessId,
        note: favoriteItems.note,
        createdAt: favoriteItems.createdAt,
        listName: favoriteLists.name,
      })
      .from(favoriteItems)
      .innerJoin(favoriteLists, eq(favoriteLists.id, favoriteItems.listId))
      .where(and(eq(favoriteItems.userId, userId), eq(favoriteItems.businessId, businessId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async countItemsInList(listId: string): Promise<number> {
    const rows = await this.client.db
      .select({ value: count() })
      .from(favoriteItems)
      .where(eq(favoriteItems.listId, listId));
    return Number(rows[0]?.value ?? 0);
  }

  async listItemRows(listId: string, page: number, pageSize: number): Promise<FavoriteItemPage> {
    const where: SQL = eq(favoriteItems.listId, listId);
    const [rows, totals] = await Promise.all([
      this.client.db
        .select({
          id: favoriteItems.id,
          userId: favoriteItems.userId,
          listId: favoriteItems.listId,
          businessId: favoriteItems.businessId,
          note: favoriteItems.note,
          createdAt: favoriteItems.createdAt,
        })
        .from(favoriteItems)
        .where(where)
        .orderBy(desc(favoriteItems.createdAt), asc(favoriteItems.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.client.db.select({ value: count() }).from(favoriteItems).where(where),
    ]);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async updateItem(
    itemId: string,
    patch: { listId?: string; note?: string | null },
  ): Promise<void> {
    const values: { listId?: string; note?: string | null } = {};
    if (patch.listId !== undefined) values.listId = patch.listId;
    if (patch.note !== undefined) values.note = patch.note;
    if (Object.keys(values).length === 0) return;
    await this.client.db.update(favoriteItems).set(values).where(eq(favoriteItems.id, itemId));
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.client.db.delete(favoriteItems).where(eq(favoriteItems.id, itemId));
  }

  async findBusinessContext(businessId: string): Promise<{
    status: string;
    deletedAt: Date | null;
  } | null> {
    const rows = await this.client.db
      .select({ status: businesses.status, deletedAt: businesses.deletedAt })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Shared single-list fetch (by pk, or by the default predicate). */
  private async findList(where: SQL): Promise<FavoriteListMeta | null> {
    const rows = await this.client.db
      .select({
        id: favoriteLists.id,
        userId: favoriteLists.userId,
        name: favoriteLists.name,
        isDefault: favoriteLists.isDefault,
        createdAt: favoriteLists.createdAt,
        updatedAt: favoriteLists.updatedAt,
      })
      .from(favoriteLists)
      .where(where)
      .limit(1);
    return rows[0] ?? null;
  }
}
