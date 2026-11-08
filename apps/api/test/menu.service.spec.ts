import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MediaFileRow } from '../src/db/schema/media.js';
import type {
  MenuSectionWithMedia,
  MenuItemWithMedia,
} from '../src/modules/business/menu/menu.repository.js';
import { MenuService } from '../src/modules/business/menu/menu.service.js';
import type { MenuRepositoryLike } from '../src/modules/business/menu/menu.repository.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';
import type { MediaService } from '../src/modules/media/media.service.js';
import type { MediaUrlService } from '../src/modules/media/media-url.service.js';
import type { ReplaceMenuBody } from '@app/contracts';

/**
 * MenuService unit tests (B2.8) — the replace orchestration exercised without
 * a database via hand-written fakes: full-replace payload → wipe + recreate,
 * photo validation (kind `menu_photo`, ownership, attachment conflicts,
 * payload-wide uniqueness), post-commit attach of new photos, soft-delete of
 * dropped photos, and the tree-shaped GET. Authorization (manage/visibility)
 * is the shared B2.5/B2.6/B2.7 helper — covered there.
 */

const BIZ = randomUUID();
const USER = { id: randomUUID(), role: 'user' };
const PHOTO_A = randomUUID();
const PHOTO_B = randomUUID();

function mediaRow(overrides: Partial<MediaFileRow> = {}): MediaFileRow {
  return {
    id: randomUUID(),
    ownerUserId: USER.id,
    kind: 'menu_photo',
    key: 'menu_photo/2026/11/x.webp',
    thumbKey: 'menu_photo/2026/11/x_t.webp',
    mime: 'image/webp',
    sizeBytes: 1234,
    width: 800,
    height: 600,
    attachedAt: null,
    createdAt: new Date('2026-11-09T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

/** In-memory fake of the menu repository; `replaced` captures the last replace. */
function makeMenuFake(opts: { items?: MenuItemWithMedia[] } = {}) {
  let sections: MenuSectionWithMedia[] = opts.items
    ? [
        {
          id: randomUUID(),
          businessId: BIZ,
          name: 'old',
          sortOrder: 0,
        },
      ]
    : [];
  let items: MenuItemWithMedia[] = opts.items ?? [];
  const replaced: ReplaceMenuBody['sections'][] = [];
  const fake: MenuRepositoryLike = {
    findBusinessContext: vi.fn(async (id: string) =>
      id === BIZ ? { ownerId: USER.id, status: 'active', deletedAt: null } : null,
    ),
    findSections: vi.fn(async () => sections),
    findItems: vi.fn(async () => items),
    replaceMenu: vi.fn(async (_businessId: string, payload: ReplaceMenuBody['sections']) => {
      replaced.push(payload);
      // Emulate the wipe + recreate with fresh ids.
      sections = payload.map((s, si) => ({
        id: randomUUID(),
        businessId: BIZ,
        name: s.name,
        sortOrder: si,
      }));
      items = [];
      for (const [si, s] of payload.entries()) {
        for (const [ii, item] of s.items.entries()) {
          const m = item.photoMediaId
            ? mediaRow({ id: item.photoMediaId, attachedAt: new Date() })
            : null;
          items.push({
            id: randomUUID(),
            businessId: BIZ,
            sectionId: sections[si]!.id,
            name: item.name,
            description: item.description ?? null,
            price: item.price ?? null,
            photoMediaId: item.photoMediaId ?? null,
            photoKey: m?.key ?? null,
            photoThumbKey: m?.thumbKey ?? null,
            isAvailable: item.isAvailable ?? true,
            sortOrder: ii,
          });
        }
      }
    }),
  };
  return { fake, itemsRef: () => items, sectionsRef: () => sections, replaced };
}

/** Media fake: `byId` resolves ids; MediaService double records attach/delete. */
function makeMediaFake(byId: Map<string, MediaFileRow>) {
  const repo = {
    insert: vi.fn(),
    findById: vi.fn(async (id: string) => byId.get(id) ?? null),
    findByKey: vi.fn(async () => null),
    markAttached: vi.fn(async (id: string) => {
      const m = byId.get(id);
      if (m) m.attachedAt = new Date();
      return m ?? null;
    }),
    softDelete: vi.fn(async () => null),
    findUnattachedOlderThan: vi.fn(async () => []),
    deleteRow: vi.fn(),
    findSoftDeletedBefore: vi.fn(async () => []),
  } as unknown as MediaRepositoryLike;
  const service = {
    markAttached: vi.fn(async (id: string) => {
      const m = byId.get(id);
      if (!m) throw new Error('not found');
      m.attachedAt = m.attachedAt ?? new Date();
      return m;
    }),
    deleteOwned: vi.fn(async () => undefined),
  } as unknown as MediaService;
  const urls = {
    urlFor: (key: string | null | undefined) => (key ? `https://media.test/${key}` : null),
  } as unknown as MediaUrlService;
  return { repo, service, urls, byId };
}

function makeService(opts: { items?: MenuItemWithMedia[]; media?: MediaFileRow[] } = {}) {
  const menu = makeMenuFake(opts);
  const map = new Map<string, MediaFileRow>();
  for (const m of opts.media ?? []) map.set(m.id, m);
  const media = makeMediaFake(map);
  const svc = new MenuService(menu.fake, media.repo, media.service, media.urls);
  return { svc, menu, media };
}

const body = (sections: ReplaceMenuBody['sections']): ReplaceMenuBody => ({ sections });

describe('MenuService.getMenu (B2.8)', () => {
  it('returns the tree: sections in order, each with its items in order', async () => {
    const sectionId = randomUUID();
    const items: MenuItemWithMedia[] = [
      {
        id: randomUUID(),
        businessId: BIZ,
        sectionId,
        name: 'قهوه',
        description: null,
        price: 150_000,
        photoMediaId: PHOTO_A,
        photoKey: 'menu_photo/2026/11/a.webp',
        photoThumbKey: 'menu_photo/2026/11/a_t.webp',
        isAvailable: true,
        sortOrder: 0,
      },
    ];
    const { svc, menu } = makeService({ items });
    (menu.fake.findSections as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: sectionId, businessId: BIZ, name: 'نوشیدنی', sortOrder: 0 },
    ]);
    const res = await svc.getMenu(BIZ);
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0]!.name).toBe('نوشیدنی');
    expect(res.sections[0]!.items[0]!.name).toBe('قهوه');
    expect(res.sections[0]!.items[0]!.price).toBe(150_000);
    expect(res.sections[0]!.items[0]!.photoUrl).toBe(
      'https://media.test/menu_photo/2026/11/a.webp',
    );
    expect(res.sections[0]!.items[0]!.photoThumbUrl).toBe(
      'https://media.test/menu_photo/2026/11/a_t.webp',
    );
  });

  it('404s a missing business context', async () => {
    const { svc } = makeService();
    await expect(svc.getBusinessContext(randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});

describe('MenuService.replaceMenu (B2.8)', () => {
  it('replaces the menu atomically and returns the fresh tree', async () => {
    const { svc, menu } = makeService();
    const res = await svc.replaceMenu(
      BIZ,
      USER,
      body([
        { name: 'غذا', items: [{ name: 'پیتزا', price: 500_000 }] },
        { name: 'نوشیدنی', items: [] },
      ]),
    );
    expect(menu.replaced).toHaveLength(1);
    expect(res.sections.map((s) => s.name)).toEqual(['غذا', 'نوشیدنی']);
    expect(res.sections[0]!.items[0]!.price).toBe(500_000);
    expect(res.sections[1]!.items).toEqual([]);
  });

  it('accepts an empty menu (payload of zero sections)', async () => {
    const { svc, menu } = makeService();
    const res = await svc.replaceMenu(BIZ, USER, body([]));
    expect(res.sections).toEqual([]);
    expect(menu.replaced).toEqual([[]]);
  });

  it('marks NEW photos attached after commit', async () => {
    const photo = mediaRow({ id: PHOTO_A });
    const { svc, media } = makeService({ media: [photo] });
    await svc.replaceMenu(
      BIZ,
      USER,
      body([{ name: 'غذا', items: [{ name: 'پیتزا', photoMediaId: PHOTO_A }] }]),
    );
    expect(media.service.markAttached).toHaveBeenCalledWith(PHOTO_A, USER.id);
  });

  it('keeps a photo that stays referenced (no re-attach of an attached media)', async () => {
    const photo = mediaRow({ id: PHOTO_A, attachedAt: new Date() });
    const oldItem: MenuItemWithMedia = {
      id: randomUUID(),
      businessId: BIZ,
      sectionId: randomUUID(),
      name: 'old',
      description: null,
      price: null,
      photoMediaId: PHOTO_A,
      photoKey: photo.key,
      photoThumbKey: photo.thumbKey,
      isAvailable: true,
      sortOrder: 0,
    };
    const { svc, media } = makeService({ items: [oldItem], media: [photo] });
    await svc.replaceMenu(
      BIZ,
      USER,
      body([{ name: 'غذا', items: [{ name: 'new', photoMediaId: PHOTO_A }] }]),
    );
    // Still attached to this business's current menu → allowed, not re-attached.
    expect(media.service.markAttached).not.toHaveBeenCalled();
    expect(media.service.deleteOwned).not.toHaveBeenCalled();
  });

  it('soft-deletes photos dropped from the payload', async () => {
    const photo = mediaRow({ id: PHOTO_A, attachedAt: new Date() });
    const oldItem: MenuItemWithMedia = {
      id: randomUUID(),
      businessId: BIZ,
      sectionId: randomUUID(),
      name: 'old',
      description: null,
      price: null,
      photoMediaId: PHOTO_A,
      photoKey: photo.key,
      photoThumbKey: photo.thumbKey,
      isAvailable: true,
      sortOrder: 0,
    };
    const { svc, media } = makeService({ items: [oldItem], media: [photo] });
    await svc.replaceMenu(BIZ, USER, body([{ name: 'غذا', items: [{ name: 'بدون عکس' }] }]));
    expect(media.service.deleteOwned).toHaveBeenCalledWith(PHOTO_A, {
      id: USER.id,
      role: USER.role,
    });
  });

  it('409s a photo attached to something other than this menu', async () => {
    const photo = mediaRow({ id: PHOTO_A, attachedAt: new Date() });
    const { svc } = makeService({ media: [photo] });
    await expect(
      svc.replaceMenu(
        BIZ,
        USER,
        body([{ name: 'غذا', items: [{ name: 'پیتزا', photoMediaId: PHOTO_A }] }]),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('422s a non-menu_photo kind', async () => {
    const photo = mediaRow({ id: PHOTO_A, kind: 'avatar' });
    const { svc } = makeService({ media: [photo] });
    await expect(
      svc.replaceMenu(
        BIZ,
        USER,
        body([{ name: 'غذا', items: [{ name: 'پیتزا', photoMediaId: PHOTO_A }] }]),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('403s a photo the caller does not own', async () => {
    const photo = mediaRow({ id: PHOTO_A, ownerUserId: randomUUID() });
    const { svc } = makeService({ media: [photo] });
    await expect(
      svc.replaceMenu(
        BIZ,
        USER,
        body([{ name: 'غذا', items: [{ name: 'پیتزا', photoMediaId: PHOTO_A }] }]),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('404s a deleted or unknown media id', async () => {
    const photo = mediaRow({ id: PHOTO_A, deletedAt: new Date() });
    const { svc } = makeService({ media: [photo] });
    await expect(
      svc.replaceMenu(
        BIZ,
        USER,
        body([{ name: 'غذا', items: [{ name: 'پیتزا', photoMediaId: PHOTO_A }] }]),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('422s a photoMediaId used by more than one item', async () => {
    const photo = mediaRow({ id: PHOTO_A });
    const { svc } = makeService({ media: [photo] });
    await expect(
      svc.replaceMenu(
        BIZ,
        USER,
        body([
          {
            name: 'غذا',
            items: [
              { name: 'پیتزا', photoMediaId: PHOTO_A },
              { name: 'پاستا', photoMediaId: PHOTO_A },
            ],
          },
        ]),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('references multiple distinct photos fine and attaches each once', async () => {
    const a = mediaRow({ id: PHOTO_A });
    const b = mediaRow({ id: PHOTO_B });
    const { svc, media } = makeService({ media: [a, b] });
    await svc.replaceMenu(
      BIZ,
      USER,
      body([
        {
          name: 'غذا',
          items: [
            { name: 'پیتزا', photoMediaId: PHOTO_A },
            { name: 'پاستا', photoMediaId: PHOTO_B },
          ],
        },
      ]),
    );
    expect(media.service.markAttached).toHaveBeenCalledTimes(2);
  });

  it('does not touch the menu when a photo fails validation (no wipe on error)', async () => {
    const photo = mediaRow({ id: PHOTO_A, kind: 'avatar' });
    const oldItem: MenuItemWithMedia = {
      id: randomUUID(),
      businessId: BIZ,
      sectionId: randomUUID(),
      name: 'old',
      description: null,
      price: null,
      photoMediaId: null,
      photoKey: null,
      photoThumbKey: null,
      isAvailable: true,
      sortOrder: 0,
    };
    const { svc, menu } = makeService({ items: [oldItem], media: [photo] });
    await expect(
      svc.replaceMenu(
        BIZ,
        USER,
        body([{ name: 'غذا', items: [{ name: 'پیتزا', photoMediaId: PHOTO_A }] }]),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(menu.replaced).toHaveLength(0);
    expect(menu.itemsRef()).toHaveLength(1);
  });
});
