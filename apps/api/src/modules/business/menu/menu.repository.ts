import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { businessMenuItems, businessMenuSections } from '../../../db/schema/menu.js';
import { businesses } from '../../../db/schema/business.js';
import { mediaFiles } from '../../../db/schema/media.js';
import type { MenuSectionInput } from '@app/contracts';

/** DI token for the menu repository (tests bind a fake). */
export const MENU_REPOSITORY = Symbol('MENU_REPOSITORY');

/** One menu section row (no join needed — sections carry no media). */
export interface MenuSectionWithMedia {
  id: string;
  businessId: string;
  name: string;
  sortOrder: number;
}

/** One menu item row joined with its photo media (key/thumbKey → URLs). */
export interface MenuItemWithMedia {
  id: string;
  businessId: string;
  sectionId: string;
  name: string;
  description: string | null;
  price: number | null;
  photoMediaId: string | null;
  photoKey: string | null;
  photoThumbKey: string | null;
  isAvailable: boolean;
  sortOrder: number;
}

/**
 * The narrow fake-able surface consumed by MenuService + B2.8's HTTP layer.
 */
export interface MenuRepositoryLike {
  findBusinessContext(
    businessId: string,
  ): Promise<{ ownerId: string | null; status: string; deletedAt: Date | null } | null>;
  findSections(businessId: string): Promise<MenuSectionWithMedia[]>;
  findItems(businessId: string): Promise<MenuItemWithMedia[]>;
  /**
   * Replace the whole menu in one transaction: sections missing from the
   * payload are deleted (their items cascade), payload rows carrying `id`
   * UPDATE (identity preserved), rows without `id` INSERT; array order
   * becomes sort_order. The caller re-reads via findSections/findItems.
   */
  replaceMenu(businessId: string, sections: MenuSectionInput[]): Promise<void>;
}

const ITEM_SELECT = {
  id: businessMenuItems.id,
  businessId: businessMenuItems.businessId,
  sectionId: businessMenuItems.sectionId,
  name: businessMenuItems.name,
  description: businessMenuItems.description,
  price: businessMenuItems.price,
  photoMediaId: businessMenuItems.photoMediaId,
  photoKey: mediaFiles.key,
  photoThumbKey: mediaFiles.thumbKey,
  isAvailable: businessMenuItems.isAvailable,
  sortOrder: businessMenuItems.sortOrder,
};

/**
 * Menu persistence (B2.8) over `business_menu_sections` + `business_menu_items`
 * (migration 0017). Items carry a denormalised business_id so the replace can
 * wipe one business's menu with scoped deletes; photo URLs resolve via a left
 * join to `media_files` (the photo is optional and FK ON DELETE SET NULL).
 */
@Injectable()
export class MenuRepository implements MenuRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(
    businessId: string,
  ): Promise<{ ownerId: string | null; status: string; deletedAt: Date | null } | null> {
    const rows = await this.client.db
      .select({
        ownerId: businesses.ownerId,
        status: businesses.status,
        deletedAt: businesses.deletedAt,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ownerId: row.ownerId, status: row.status, deletedAt: row.deletedAt };
  }

  async findSections(businessId: string): Promise<MenuSectionWithMedia[]> {
    return this.client.db
      .select({
        id: businessMenuSections.id,
        businessId: businessMenuSections.businessId,
        name: businessMenuSections.name,
        sortOrder: businessMenuSections.sortOrder,
      })
      .from(businessMenuSections)
      .where(eq(businessMenuSections.businessId, businessId))
      .orderBy(asc(businessMenuSections.sortOrder), asc(businessMenuSections.createdAt));
  }

  async findItems(businessId: string): Promise<MenuItemWithMedia[]> {
    return this.client.db
      .select(ITEM_SELECT)
      .from(businessMenuItems)
      .leftJoin(mediaFiles, eq(mediaFiles.id, businessMenuItems.photoMediaId))
      .where(eq(businessMenuItems.businessId, businessId))
      .orderBy(asc(businessMenuItems.sortOrder), asc(businessMenuItems.createdAt));
  }

  async replaceMenu(businessId: string, sections: MenuSectionInput[]): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      // Wipe first (items explicitly, then sections — items also cascade, but
      // the explicit delete keeps the denormalised business_id authoritative).
      await tx.delete(businessMenuItems).where(eq(businessMenuItems.businessId, businessId));
      await tx.delete(businessMenuSections).where(eq(businessMenuSections.businessId, businessId));

      for (let s = 0; s < sections.length; s++) {
        const section = sections[s];
        if (!section) continue;
        const insertedSection = await tx
          .insert(businessMenuSections)
          .values({ businessId, name: section.name, sortOrder: s })
          .returning({ id: businessMenuSections.id });
        const sectionId = insertedSection[0]?.id;
        if (!sectionId) throw new Error('business_menu_sections insert returned no rows');
        if (section.items.length === 0) continue;
        await tx.insert(businessMenuItems).values(
          section.items.map((item, i) => ({
            businessId,
            sectionId,
            name: item.name,
            description: item.description ?? null,
            price: item.price ?? null,
            photoMediaId: item.photoMediaId ?? null,
            isAvailable: item.isAvailable ?? true,
            sortOrder: i,
          })),
        );
      }
    });
  }
}
