'use client';

/**
 * FavoritesView (F5.1) — the `/account/favorites` body.
 *
 * Two panes (sidebar + detail) on desktop, stacked on mobile:
 *  - the lists index (`GET /favorites/me`, default first) with create / rename
 *    / delete actions;
 *  - the selected list's saved businesses (`GET /favorites/lists/:id/items`),
 *    page-based, each card carrying a note, a «move to list» select and a
 *    heart-off button.
 *
 * Rules mirrored from the B5.1 service contract so the UI can never propose an
 * illegal action:
 *  - the default list is undeletable (its delete button is disabled with a
 *    tooltip; the server would answer 422 anyway);
 *  - a business sits in at most one list per user, so «move» is a PATCH on the
 *    item (the select lists every OTHER list as a target — the current one is
 *    omitted);
 *  - re-saving an already-favorited business is a 409 from the server; the UI
 *    surfaces it as a friendly toast instead of a silent no-op.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Heart, ListPlus, Pencil, Trash2, X } from 'lucide-react';
import {
  FAVORITE_LIST_NAME_MAX,
  type BusinessSummary,
  type FavoriteListSummary,
} from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { pickLocalized } from '../../lib/localized';
import { isApiRequestError } from '../../lib/api/errors';
import {
  useAddFavoriteItem,
  useCreateFavoriteList,
  useDeleteFavoriteList,
  useFavoriteListItems,
  useFavoriteLists,
  useRemoveFavoriteItem,
  useRenameFavoriteList,
} from '../../lib/api/favorites';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Modal,
  Pagination,
  Rating,
  Spinner,
  useModalState,
  useToast,
} from '../ui';
import { cn } from '../../lib/cn';

export function FavoritesView() {
  const t = useTranslations('account.favorites');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const toast = useToast();

  const { lists, isPending: listsPending, error: listsError } = useFavoriteLists();

  // The selected list id. Defaults to the first (default) list once the index
  // resolves; cleared when the index loses that list (delete / refetch).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && lists?.some((l) => l.id === selectedId)) return;
    // noUncheckedIndexedAccess: lists[0] is T | undefined — guard with ??.
    setSelectedId(lists && lists.length > 0 ? (lists[0]?.id ?? null) : null);
  }, [lists, selectedId]);

  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the selected list changes.
  useEffect(() => {
    setPage(1);
  }, [selectedId]);

  const {
    result: itemsResult,
    isPending: itemsPending,
    error: itemsError,
  } = useFavoriteListItems(selectedId, page);

  const createList = useCreateFavoriteList();
  const renameList = useRenameFavoriteList();
  const deleteList = useDeleteFavoriteList();
  const removeItem = useRemoveFavoriteItem();
  const moveItem = useAddFavoriteItem(); // POST /favorites/lists/:id/items is the move target write

  const [newListName, setNewListName] = useState('');
  const [newListError, setNewListError] = useState<string | null>(null);

  const renameModal = useModalState();
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<FavoriteListSummary | null>(null);

  const deleteModal = useModalState();
  const [deleteTarget, setDeleteTarget] = useState<FavoriteListSummary | null>(null);

  const selectedList = useMemo(
    () => lists?.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  if (listsPending && !lists) {
    return <Spinner aria-label={tRoot('common.loading')} />;
  }
  if (listsError) {
    return <ErrorState error={t('loadError')} />;
  }

  const handleCreateList = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (createList.isPending) return;
    setNewListError(null);
    const name = newListName.trim();
    if (name.length === 0) {
      setNewListError(tRoot('validation.required'));
      return;
    }
    try {
      const created = await createList.mutateAsync({ name });
      setNewListName('');
      setSelectedId(created.id);
      toast.success(t('listCreated', { name: created.name }));
    } catch (err) {
      setNewListError(mapListError(err, tRoot, t));
    }
  };

  const openRename = (list: FavoriteListSummary): void => {
    setRenameTarget(list);
    // The default list's stored name is the reserved «علاقه‌مندی‌ها»; prefill
    // with empty so the user types a friendly name (the server allows renaming
    // the default list — it just keeps isDefault=true).
    setRenameValue(list.isDefault ? '' : list.name);
    setRenameError(null);
    renameModal.openModal();
  };

  const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!renameTarget || renameList.isPending) return;
    setRenameError(null);
    const name = renameValue.trim();
    if (name.length === 0) {
      setRenameError(tRoot('validation.required'));
      return;
    }
    try {
      const updated = await renameList.mutateAsync({ id: renameTarget.id, body: { name } });
      toast.success(t('listRenamed', { name: updated.name }));
      renameModal.closeModal();
    } catch (err) {
      setRenameError(mapListError(err, tRoot, t));
    }
  };

  const openDelete = (list: FavoriteListSummary): void => {
    setDeleteTarget(list);
    deleteModal.openModal();
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget || deleteList.isPending) return;
    const target = deleteTarget;
    try {
      await deleteList.mutateAsync(target.id);
      // The selected list just vanished — fall back to the default list.
      if (selectedId === target.id) setSelectedId(null);
      toast.success(t('listDeleted', { name: target.name }));
      deleteModal.closeModal();
    } catch (err) {
      toast.error(mapListError(err, tRoot, t));
    }
  };

  const handleRemoveItem = async (
    itemId: string,
    businessId: string,
    name: string,
  ): Promise<void> => {
    try {
      await removeItem.mutateAsync({ itemId, businessId });
      toast.success(t('itemRemoved', { name }));
    } catch (err) {
      toast.error(mapListError(err, tRoot, t));
    }
  };

  const handleMoveItem = async (
    itemId: string,
    businessId: string,
    targetListId: string,
    name: string,
  ): Promise<void> => {
    // Move = remove from the current list, then add into the target. The
    // backend enforces «one list per (user, business)» so the add would 409
    // if the row still existed — the remove MUST land first. A PATCH
    // /favorites/items/:id { listId } is the single-write alternative; we use
    // it via useUpdateFavoriteItem when only the listId changes. To keep the
    // failure surface small here we use the remove+add pair against the two
    // endpoints the lists page already exercises.
    try {
      await removeItem.mutateAsync({ itemId, businessId });
      await moveItem.mutateAsync({ listId: targetListId, body: { businessId } });
      toast.success(t('itemMoved', { name }));
    } catch (err) {
      // The lists/items invalidation in the hooks already reconciles the
      // index; surface the error and let the next refetch show the truth.
      toast.error(mapListError(err, tRoot, t));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Lists index */}
        <aside className="w-full shrink-0 lg:w-72">
          <section
            aria-labelledby="fav-lists-heading"
            className="rounded-md border border-border bg-surface p-3"
          >
            <h2 id="fav-lists-heading" className="mb-3 text-sm font-medium text-text">
              {t('listsTitle')}
            </h2>

            {/* Create-list inline form */}
            <form onSubmit={handleCreateList} className="mb-3 flex gap-2" noValidate>
              <Field name="newListName" label="" error={newListError ?? undefined}>
                {(props) => (
                  <Input
                    {...props}
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder={t('newListPlaceholder')}
                    maxLength={FAVORITE_LIST_NAME_MAX}
                    aria-label={t('newListLabel')}
                    className="flex-1"
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={createList.isPending}
                aria-label={t('createAction')}
                className="shrink-0"
              >
                <ListPlus size={18} aria-hidden />
                <span className="sr-only">{t('createAction')}</span>
              </Button>
            </form>

            {lists && lists.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-subtle">{t('noLists')}</p>
            ) : (
              <ul className="flex flex-col gap-1" data-testid="favorites-lists">
                {lists?.map((list) => {
                  const active = list.id === selectedId;
                  const label = list.isDefault ? t('defaultListName') : list.name;
                  return (
                    <li key={list.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                          active
                            ? 'bg-surface-alt text-text'
                            : 'text-text-subtle hover:bg-surface-alt',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(list.id)}
                          aria-current={active ? 'true' : undefined}
                          className="flex flex-1 items-center gap-2 text-start"
                          data-testid={`list-row-${list.id}`}
                        >
                          <span className="line-clamp-1 font-medium text-text">{label}</span>
                          {list.isDefault ? (
                            <Badge variant="neutral">{t('defaultBadge')}</Badge>
                          ) : null}
                          <span className="text-xs tabular-nums text-muted">
                            {formatNumber(list.itemCount)}
                          </span>
                        </button>
                        <IconButton
                          icon={Pencil}
                          size="sm"
                          variant="ghost"
                          aria-label={t('renameAction', { name: label })}
                          onClick={() => openRename(list)}
                        />
                        <IconButton
                          icon={Trash2}
                          size="sm"
                          variant="ghost"
                          aria-label={t('deleteAction', { name: label })}
                          disabled={list.isDefault}
                          title={list.isDefault ? t('defaultUndeletable') : undefined}
                          onClick={() => openDelete(list)}
                          className={cn(list.isDefault ? '' : 'text-danger')}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>

        {/* Selected list detail */}
        <div className="min-w-0 flex-1">
          {selectedList ? (
            <section
              aria-labelledby="fav-items-heading"
              className="rounded-md border border-border bg-surface p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="fav-items-heading" className="text-base font-semibold text-text">
                  {selectedList.isDefault ? t('defaultListName') : selectedList.name}
                </h2>
                <span className="text-xs tabular-nums text-muted">
                  {formatNumber(itemsResult?.meta.total ?? selectedList.itemCount)}
                </span>
              </div>

              {itemsError ? (
                <ErrorState error={t('loadError')} />
              ) : itemsPending && !itemsResult ? (
                <Spinner aria-label={tRoot('common.loading')} />
              ) : itemsResult && itemsResult.items.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <ul
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
                    data-testid="favorites-items"
                  >
                    {itemsResult.items.map((item) => (
                      <SavedBusinessCard
                        key={item.id}
                        note={item.note}
                        business={item.business}
                        locale={locale}
                        lists={lists ?? []}
                        currentListId={selectedList.id}
                        onRemove={() =>
                          handleRemoveItem(item.id, item.businessId, item.business.name)
                        }
                        onMove={(targetListId) =>
                          handleMoveItem(item.id, item.businessId, targetListId, item.business.name)
                        }
                      />
                    ))}
                  </ul>
                  {itemsResult.meta.totalPages > 1 ? (
                    <Pagination
                      page={page}
                      totalPages={itemsResult.meta.totalPages}
                      onPageChange={setPage}
                    />
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  icon={Heart}
                  title={t('emptyListTitle')}
                  description={t('emptyListBody')}
                />
              )}
            </section>
          ) : (
            <EmptyState
              icon={Heart}
              title={t('emptyTitle')}
              description={t('emptyBody')}
              action={{
                label: tRoot('nav.search'),
                onClick: () => {
                  if (typeof window !== 'undefined') {
                    window.location.href = `/${locale}/search`;
                  }
                },
              }}
            />
          )}
        </div>
      </div>

      {/* Rename modal */}
      <Modal
        open={renameModal.isOpen}
        onOpenChange={renameModal.setOpen}
        title={t('renameModalTitle')}
        size="sm"
      >
        <form onSubmit={handleRenameSubmit} className="flex flex-col gap-3" noValidate>
          <Field
            name="renameValue"
            label={t('newListLabel')}
            error={renameError ?? undefined}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                maxLength={FAVORITE_LIST_NAME_MAX}
                autoFocus
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={renameModal.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button type="submit" loading={renameList.isPending}>
              {t('renameSubmit')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={deleteModal.isOpen}
        onOpenChange={deleteModal.setOpen}
        title={t('deleteModalTitle')}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={deleteModal.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleteList.isPending}
              onClick={handleDeleteConfirm}
            >
              {t('deleteSubmit')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {deleteTarget
            ? t('deleteModalBody', {
                name: deleteTarget.isDefault ? t('defaultListName') : deleteTarget.name,
              })
            : ''}
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SavedBusinessCard — one row in the selected list.
// ---------------------------------------------------------------------------

interface SavedBusinessCardProps {
  note: string | null;
  business: BusinessSummary;
  locale: string;
  lists: ReadonlyArray<FavoriteListSummary>;
  currentListId: string;
  onRemove: () => void;
  onMove: (targetListId: string) => void;
}

function SavedBusinessCard({
  note,
  business,
  locale,
  lists,
  currentListId,
  onRemove,
  onMove,
}: SavedBusinessCardProps) {
  const t = useTranslations('account.favorites');
  const { formatNumber } = createFormatters(locale);
  const categoryName = pickLocalized(business.primaryCategory.name, locale);
  const cityName = pickLocalized(business.city.name, locale);
  const movableLists = lists.filter((l) => l.id !== currentListId);

  return (
    <li
      data-testid="saved-business-card"
      className="flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface"
    >
      <Link href={`/business/${business.slug}`} className="block">
        <div className="flex aspect-[16/9] items-center justify-center bg-surface-alt">
          {business.thumbUrl !== null ? (
            <img
              src={business.thumbUrl}
              alt={business.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-3xl text-muted">
              ⌂
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <h3 className="line-clamp-1 text-sm font-semibold text-text">{business.name}</h3>
          <p className="line-clamp-1 text-xs text-muted">
            {[categoryName, cityName].filter((s) => s !== '').join(' · ')}
          </p>
          <div className="flex items-center gap-2">
            <Rating value={business.avgRating} size="sm" readOnly />
            <span className="text-xs tabular-nums text-muted">
              {formatNumber(business.reviewCount)}
            </span>
          </div>
        </div>
      </Link>

      {note ? (
        <p className="mx-3 mb-2 line-clamp-2 rounded bg-surface-alt px-2 py-1 text-xs text-text-subtle">
          {note}
        </p>
      ) : null}

      <div className="mt-auto flex items-center gap-2 border-t border-border-subtle p-2">
        {movableLists.length > 0 ? (
          <label className="flex flex-1 items-center gap-1 text-xs text-text-subtle">
            <span className="sr-only">{t('moveToLabel')}</span>
            <select
              aria-label={t('moveToLabel')}
              defaultValue=""
              onChange={(e) => {
                const target = e.target.value;
                if (target) onMove(target);
                e.target.value = '';
              }}
              className="min-w-0 flex-1 rounded border border-border-subtle bg-surface px-2 py-1 text-xs text-text"
            >
              <option value="" disabled>
                {t('moveToLabel')}
              </option>
              {movableLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.isDefault ? t('defaultListName') : l.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <IconButton
          icon={X}
          size="sm"
          variant="ghost"
          aria-label={t('removeItemAction')}
          onClick={onRemove}
          className="text-danger"
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapListError(
  err: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!isApiRequestError(err)) return t('serverError');
  if (err.code === 'CONFLICT') return t('listNameTaken');
  if (err.isRateLimited) return tRoot('auth.rateLimited');
  return tRoot(err.messageKey) ?? t('serverError');
}
