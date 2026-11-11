import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  AddFavoriteItemBody,
  CreateFavoriteListBody,
  DeleteFavoriteItemResult,
  DeleteFavoriteListResult,
  FavoriteItem,
  FavoriteListItem,
  FavoriteListItemsResult,
  FavoriteListSummary,
  FavoriteStatusResult,
  MyFavoriteListsResult,
  UpdateFavoriteItemBody,
  UpdateFavoriteListBody,
} from '@app/contracts';
import {
  FAVORITE_DEFAULT_LIST_NAME,
  FAVORITE_MAX_ITEMS_PER_LIST,
  FAVORITE_MAX_LISTS_PER_USER,
} from '@app/contracts';
import type { BusinessActor } from '../business/business-access.js';
import {
  BUSINESSES_REPOSITORY,
  type BusinessesRepositoryLike,
} from '../business/businesses.repository.js';
import {
  FAVORITES_REPOSITORY,
  type FavoriteItemMeta,
  type FavoriteListMeta,
  type FavoritesRepositoryLike,
} from './favorites.repository.js';

/**
 * Domain events (AGENTS.md 6). B5.2's activity feed and B5.7's notification
 * wiring subscribe to these — nothing subscribes yet (B5.1 scope). The
 * payload carries the actor's userId next to the businessId so downstream
 * consumers never need a second lookup.
 */
export const FAVORITES_EVENTS = {
  /** A business was saved into one of the user's lists. */
  added: 'favorite.added',
  /** A saved business was removed (heart-off, item delete, list delete). */
  removed: 'favorite.removed',
  /** A named list was created (the default list is NOT announced). */
  listCreated: 'favorite.list.created',
  /** A named list was deleted (its items are announced via removed). */
  listDeleted: 'favorite.list.deleted',
} as const;

function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
}

function conflictException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'CONFLICT' as const,
      messageKey: 'errors.conflict',
      message,
      details,
    },
    HttpStatus.CONFLICT,
  );
}

function ruleException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message,
      details,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Favorites and named lists (B5.1). Rules:
 * - every write target is OWNER-ONLY and a foreign/missing id answers the
 *   SAME 404 (never leaks other users' list/item existence);
 * - the default list is created lazily on the first WRITE (never on a read)
 *   and can never be deleted or re-created by user input;
 * - a business sits in AT MOST ONE list per user (the storage-level
 *   `favorite_items_one_per_user` unique index; a duplicate insert is a 409,
 *   moving between lists is PATCH /favorites/items/:id);
 * - only `active`, non-deleted businesses can be newly favorited (404 for
 *   missing/deleted, 422 for a pending/suspended one);
 * - caps: FAVORITE_MAX_LISTS_PER_USER lists (default included) and
 *   FAVORITE_MAX_ITEMS_PER_LIST items per list (422, not a silent truncation);
 * - every successful write emits a domain event (B5.2 feed / B5.7 notify).
 */
@Injectable()
export class FavoritesService {
  constructor(
    @Inject(FAVORITES_REPOSITORY) private readonly repo: FavoritesRepositoryLike,
    @Inject(BUSINESSES_REPOSITORY) private readonly businesses: BusinessesRepositoryLike,
    private readonly events: EventEmitter2,
  ) {}

  /** GET /favorites/me — lists with counts (default first, then newest). */
  async listMine(userId: string): Promise<MyFavoriteListsResult> {
    const rows = await this.repo.listSummariesByUser(userId);
    return { lists: rows.map((row) => this.toListSummary(row)) };
  }

  /** GET /favorites/me/check?businessId=… — the heart state, one probe. */
  async status(userId: string, businessId: string): Promise<FavoriteStatusResult> {
    const item = await this.repo.findItemByUserAndBusiness(userId, businessId);
    if (!item) {
      return { businessId, favorited: false, listId: null, listName: null, itemId: null };
    }
    return {
      businessId,
      favorited: true,
      listId: item.listId,
      listName: item.listName,
      itemId: item.id,
    };
  }

  /** POST /favorites/lists — a new named list. */
  async createList(userId: string, input: CreateFavoriteListBody): Promise<FavoriteListSummary> {
    const total = await this.repo.countListsByUser(userId);
    if (total >= FAVORITE_MAX_LISTS_PER_USER) {
      throw ruleException('Too many lists', {
        reason: 'max_lists',
        max: FAVORITE_MAX_LISTS_PER_USER,
      });
    }
    if (input.name === FAVORITE_DEFAULT_LIST_NAME) {
      // Reserved: the implicit default list owns this name, and letting a
      // named list take it would make the lazy default creation unresolvable.
      throw ruleException('This list name is reserved', { reason: 'reserved_name' });
    }
    const row = await this.repo.insertList({ userId, name: input.name, isDefault: false });
    if (!row) {
      throw conflictException('A list with this name already exists', { name: input.name });
    }
    this.events.emit(FAVORITES_EVENTS.listCreated, {
      userId,
      listId: row.id,
      name: row.name,
    });
    return this.toListSummary({ ...row, itemCount: 0 });
  }

  /** PATCH /favorites/lists/:id — rename (owner-only; the default list may be renamed too). */
  async renameList(
    listId: string,
    user: BusinessActor,
    input: UpdateFavoriteListBody,
  ): Promise<FavoriteListSummary> {
    const list = await this.requireOwnedList(listId, user.id);
    if (input.name !== list.name) {
      const sibling = await this.repo
        .listSummariesByUser(user.id)
        .then((rows) => rows.find((r) => r.name === input.name && r.id !== listId));
      if (sibling) {
        throw conflictException('A list with this name already exists', { name: input.name });
      }
    }
    await this.repo.renameList(listId, input.name);
    const itemCount = await this.repo.countItemsInList(listId);
    return this.toListSummary({ ...list, name: input.name, updatedAt: new Date(), itemCount });
  }

  /** DELETE /favorites/lists/:id — the default list is undeletable (422). */
  async deleteList(listId: string, user: BusinessActor): Promise<DeleteFavoriteListResult> {
    const list = await this.requireOwnedList(listId, user.id);
    if (list.isDefault) {
      throw ruleException('The default list cannot be deleted', {
        reason: 'default_list',
        listId,
      });
    }
    // Announce every item the cascade takes with the list (B5.2 feed
    // consistency: a heart must never stay on for a row that no longer
    // exists). One event per item, BEFORE the delete — the payload is the
    // last truthful snapshot.
    const page = await this.repo.listItemRows(listId, 1, FAVORITE_MAX_ITEMS_PER_LIST);
    for (const item of page.rows) {
      this.events.emit(FAVORITES_EVENTS.removed, {
        userId: item.userId,
        businessId: item.businessId,
        listId: item.listId,
        itemId: item.id,
      });
    }
    await this.repo.deleteList(listId);
    this.events.emit(FAVORITES_EVENTS.listDeleted, { userId: user.id, listId });
    return { deleted: true };
  }

  /** GET /favorites/lists/:id/items — saved businesses as full cards. */
  async listItems(
    listId: string,
    user: BusinessActor,
    query: { page: number; pageSize: number },
  ): Promise<FavoriteListItemsResult> {
    await this.requireOwnedList(listId, user.id);
    const { rows, total } = await this.repo.listItemRows(listId, query.page, query.pageSize);
    const cards = await this.businesses.findSummariesByIds([
      ...new Set(rows.map((r) => r.businessId)),
    ]);
    const cardById = new Map(cards.map((c) => [c.id, c]));
    // A business soft-deleted between the two reads has no card — the row is
    // skipped (it would cascade away on the next write anyway).
    const items: FavoriteListItem[] = [];
    for (const row of rows) {
      const business = cardById.get(row.businessId);
      if (business) {
        items.push(this.toListItem(row, business));
      }
    }
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  /** POST /favorites/lists/:id/items — save a business into a list. */
  async addItem(
    listId: string,
    user: BusinessActor,
    input: AddFavoriteItemBody,
  ): Promise<FavoriteItem> {
    // Ownership first (404-never-leak), then the business gates. The fetched
    // row doubles as the existence proof for the write below.
    await this.requireOwnedList(listId, user.id);
    const business = await this.repo.findBusinessContext(input.businessId);
    if (!business || business.deletedAt) {
      throw notFoundException('Business', input.businessId);
    }
    if (business.status !== 'active') {
      throw ruleException('Only active businesses can be favorited', {
        businessId: input.businessId,
        status: business.status,
      });
    }
    const count = await this.repo.countItemsInList(listId);
    if (count >= FAVORITE_MAX_ITEMS_PER_LIST) {
      throw ruleException('This list is full', {
        reason: 'max_items',
        listId,
        max: FAVORITE_MAX_ITEMS_PER_LIST,
      });
    }
    const row = await this.repo.insertItem({
      userId: user.id,
      listId,
      businessId: input.businessId,
      note: input.note ?? null,
    });
    if (!row) {
      // favorite_items_one_per_user rejected the insert — the business is
      // already in one of the user's lists; the client PATCHes to move it.
      throw conflictException('This business is already in one of your lists', {
        businessId: input.businessId,
      });
    }
    this.events.emit(FAVORITES_EVENTS.added, {
      userId: user.id,
      businessId: input.businessId,
      listId,
      itemId: row.id,
    });
    return this.toItem(row);
  }

  /**
   * POST /favorites/items — the heart toggle's add half: saves into the
   * user's default list, creating it lazily on the first ever write.
   */
  async addToDefault(user: BusinessActor, input: AddFavoriteItemBody): Promise<FavoriteItem> {
    const list = await this.ensureDefaultList(user.id);
    return this.addItem(list.id, user, input);
  }

  /** PATCH /favorites/items/:id — move between lists and/or edit the note. */
  async updateItem(
    itemId: string,
    user: BusinessActor,
    input: UpdateFavoriteItemBody,
  ): Promise<FavoriteItem> {
    const item = await this.repo.findItemById(itemId);
    if (!item || item.userId !== user.id) {
      // The SAME 404 for missing and foreign rows — no existence leak.
      throw notFoundException('Favorite item', itemId);
    }
    if (input.listId !== undefined && input.listId !== item.listId) {
      const target = await this.requireOwnedList(input.listId, user.id);
      const count = await this.repo.countItemsInList(target.id);
      if (count >= FAVORITE_MAX_ITEMS_PER_LIST) {
        throw ruleException('The target list is full', {
          reason: 'max_items',
          listId: target.id,
          max: FAVORITE_MAX_ITEMS_PER_LIST,
        });
      }
    }
    await this.repo.updateItem(itemId, {
      listId: input.listId,
      note: input.note,
    });
    const fresh = await this.repo.findItemById(itemId);
    return this.toItem(fresh ?? item);
  }

  /** DELETE /favorites/items/:id — the heart-off half (or list cleanup). */
  async removeItem(itemId: string, user: BusinessActor): Promise<DeleteFavoriteItemResult> {
    const item = await this.repo.findItemById(itemId);
    if (!item || item.userId !== user.id) {
      throw notFoundException('Favorite item', itemId);
    }
    await this.repo.deleteItem(itemId);
    this.events.emit(FAVORITES_EVENTS.removed, {
      userId: user.id,
      businessId: item.businessId,
      listId: item.listId,
      itemId: item.id,
    });
    return { deleted: true };
  }

  /**
   * The default list, created lazily. The ONLY place a default row is ever
   * born: name-conflict races against `favorite_lists_user_name_unq` (a
   * named list grabbed the reserved name before B5.1 shipped) re-resolve by
   * re-reading; the partial default unique races re-read too.
   */
  private async ensureDefaultList(userId: string): Promise<FavoriteListMeta> {
    const existing = await this.repo.findDefaultList(userId);
    if (existing) return existing;
    const inserted = await this.repo.insertList({
      userId,
      name: FAVORITE_DEFAULT_LIST_NAME,
      isDefault: true,
    });
    if (inserted) return inserted;
    // Lost a race (another request created it first, or the reserved name is
    // taken by a legacy named list) — re-read both shapes before giving up.
    const again = await this.repo.findDefaultList(userId);
    if (again) return again;
    throw ruleException('The default list name is taken by a named list', {
      reason: 'reserved_name',
    });
  }

  /** The 404-never-leak rule: missing AND foreign ids answer identically. */
  private async requireOwnedList(listId: string, userId: string): Promise<FavoriteListMeta> {
    const list = await this.repo.findListById(listId);
    if (!list || list.userId !== userId) {
      throw notFoundException('Favorite list', listId);
    }
    return list;
  }

  private toListSummary(row: {
    id: string;
    name: string;
    isDefault: boolean;
    itemCount: number;
    createdAt: Date;
    updatedAt: Date;
  }): FavoriteListSummary {
    return {
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
      itemCount: row.itemCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItem(row: FavoriteItemMeta): FavoriteItem {
    return {
      id: row.id,
      listId: row.listId,
      businessId: row.businessId,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toListItem(
    row: FavoriteItemMeta,
    business: FavoriteListItem['business'],
  ): FavoriteListItem {
    return {
      id: row.id,
      businessId: row.businessId,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      business,
    };
  }
}
