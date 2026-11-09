'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Search, Trash2, Wifi } from 'lucide-react';
import { z } from 'zod';
import {
  CATEGORY_ACCENTS,
  categoryKindSchema,
  type AdminCategory,
  type Amenity,
  type LocalizedText,
} from '@app/contracts';
import {
  useAdminAmenities,
  useAdminCategories,
  useCategoryAmenityIds,
  useCreateCategory,
  useDeleteCategory,
  useSetCategoryAmenities,
  useUpdateCategory,
} from '@/lib/api/admin-catalog';
import { AdminTable } from '@/components/admin/admin-table';
import {
  IconSelect,
  LocalizedTextFields,
  StringSelect,
  iconByName,
  translateIssue,
} from '@/components/admin/admin-forms';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Checkbox } from '@/components/ui/form/checkbox';
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/form/switch';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api/errors';
import { pickName } from '../cities/cities-admin';

export type { LocalizedText };

interface CategoryFormState {
  nameFa: string;
  nameEn: string;
  slug: string;
  icon: string;
  color: string;
  kind: string;
  supportsReservation: boolean;
  isActive: boolean;
  sortOrder: string;
  parentId: string;
}

const EMPTY: CategoryFormState = {
  nameFa: '',
  nameEn: '',
  slug: '',
  icon: 'utensils',
  color: '',
  kind: 'none',
  supportsReservation: false,
  isActive: true,
  sortOrder: '100',
  parentId: '',
};

const kindOptions = categoryKindSchema.options.map((k) => ({ value: k, label: k }));
const colorOptions = [
  { value: '', label: '—' },
  ...CATEGORY_ACCENTS.map((c) => ({ value: c, label: c })),
];

const categoryFormSchema = z.object({
  nameFa: z.string().trim().min(1, 'validation.required'),
  nameEn: z.string().trim(),
  slug: z
    .string()
    .trim()
    .regex(/^$|^[a-z0-9][a-z0-9-]*$/, 'admin.form.slugFormat'),
  icon: z.string().min(1, 'validation.required'),
  sortOrder: z.coerce.number({ message: 'validation.required' }).int(),
});

type FormErrors = Partial<Record<keyof CategoryFormState, string>>;

/** Depth-first ordering with parents before their children. */
function orderTree(items: AdminCategory[]): Array<AdminCategory & { depth: number }> {
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const item of items) {
    const key = item.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), item]);
  }
  const out: Array<AdminCategory & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const item of byParent.get(parentId) ?? []) {
      out.push({ ...item, depth });
      if (depth < 1) walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (a child whose parent is missing/inactive elsewhere) still show.
  const seen = new Set(out.map((i) => i.id));
  for (const item of items) {
    if (!seen.has(item.id)) out.push({ ...item, depth: 0 });
  }
  return out;
}

/**
 * `/admin/categories` (F2.2) — the two-level category tree: create/edit
 * modal (root or under a root), inline active toggle, delete, and the
 * amenity mapping dialog from B2.3 (`GET/PUT /admin/categories/:id/amenities`).
 */
export function CategoriesAdmin() {
  const t = useTranslations('admin.categories');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const toast = useToast();
  const locale = useLocale();

  const categories = useAdminCategories();
  const createOne = useCreateCategory();
  const updateOne = useUpdateCategory();
  const deleteOne = useDeleteCategory();

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<
    { mode: 'create'; parentId: string | null } | { mode: 'edit'; item: AdminCategory } | null
  >(null);
  const [form, setForm] = useState<CategoryFormState>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pendingDelete, setPendingDelete] = useState<AdminCategory | null>(null);
  const [mappingFor, setMappingFor] = useState<AdminCategory | null>(null);

  const set = (patch: Partial<CategoryFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const rows = useMemo(() => {
    const ordered = orderTree(categories.data ?? []);
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (c) =>
        (c.name.fa ?? '').toLowerCase().includes(q) ||
        (c.name.en ?? '').toLowerCase().includes(q) ||
        c.slug.includes(q),
    );
  }, [categories.data, search]);

  const openCreate = (parentId: string | null) => {
    setForm({ ...EMPTY, parentId: parentId ?? '' });
    setErrors({});
    setEditor({ mode: 'create', parentId });
  };

  const openEdit = (item: AdminCategory) => {
    setForm({
      nameFa: item.name.fa ?? '',
      nameEn: item.name.en ?? '',
      slug: item.slug,
      icon: item.icon,
      color: item.color ?? '',
      kind: item.kind,
      supportsReservation: item.supportsReservation,
      isActive: item.isActive,
      sortOrder: String(item.sortOrder),
      parentId: item.parentId ?? '',
    });
    setErrors({});
    setEditor({ mode: 'edit', item });
  };

  const submit = async () => {
    if (!editor) return;
    const parsed = categoryFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !next[key as keyof FormErrors]) {
          next[key as keyof FormErrors] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    const name = {
      fa: form.nameFa.trim(),
      ...(form.nameEn.trim() ? { en: form.nameEn.trim() } : {}),
    };
    const common = {
      name,
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      icon: form.icon as AdminCategory['icon'],
      color: form.color === '' ? null : (form.color as AdminCategory['color']),
      kind: form.kind as AdminCategory['kind'],
      supportsReservation: form.supportsReservation,
      sortOrder: Number(form.sortOrder),
    };
    try {
      if (editor.mode === 'create') {
        await createOne.mutateAsync({ ...common, parentId: form.parentId || null });
        toast.success(t('created'));
      } else {
        await updateOne.mutateAsync({
          id: editor.item.id,
          body: { ...common, isActive: form.isActive },
        });
        toast.success(t('updated'));
      }
      setEditor(null);
    } catch (err) {
      toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteOne.mutateAsync(pendingDelete.id);
      toast.success(t('deleted'));
    } catch (err) {
      toast.error(
        isApiRequestError(err) && err.isClientError ? t('deleteBlocked') : tForm('deleteFailed'),
      );
    } finally {
      setPendingDelete(null);
    }
  };

  const toggleActive = async (item: AdminCategory, isActive: boolean) => {
    try {
      await updateOne.mutateAsync({ id: item.id, body: { isActive } });
    } catch {
      toast.error(tForm('saveFailed'));
    }
  };

  return (
    <>
      <AdminTable<AdminCategory & { depth: number }>
        columns={[
          {
            id: 'name',
            header: t('colName'),
            cell: (item) => {
              const Icon = iconByName(item.icon);
              return (
                <div style={{ paddingInlineStart: `${item.depth * 24}px` }}>
                  <span className="flex items-center gap-2 font-medium">
                    {Icon ? <Icon size={16} aria-hidden className="text-muted" /> : null}
                    {pickName(item.name, locale)}
                  </span>
                  <span className="block text-xs text-text-subtle" dir="ltr">
                    {item.slug}
                  </span>
                </div>
              );
            },
          },
          {
            id: 'kind',
            header: t('colKind'),
            cell: (item) => (
              <span className="text-text-subtle">
                {t(`kind.${item.kind}`)}
                {item.supportsReservation ? ` · ${t('reservation')}` : ''}
              </span>
            ),
          },
          {
            id: 'counts',
            header: t('colCounts'),
            cell: (item) => (
              <span className="text-text-subtle">
                {t('childCount', { count: item.childCount })} ·{' '}
                {t('businessCount', { count: item.businessCount })}
              </span>
            ),
          },
          {
            id: 'active',
            header: t('activeLabel'),
            cell: (item) => (
              <Switch
                label={<span className="sr-only">{t('activeLabel')}</span>}
                checked={item.isActive}
                disabled={updateOne.isPending}
                onChange={(checked) => void toggleActive(item, checked)}
              />
            ),
          },
          {
            id: 'actions',
            header: t('actionsLabel'),
            cell: (item) => (
              <div className="flex items-center gap-1">
                {item.depth === 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => openCreate(item.id)}>
                    <Plus size={14} aria-hidden />
                    {t('addSub')}
                  </Button>
                ) : null}
                <IconButton
                  icon={Wifi}
                  aria-label={t('amenitiesLabel')}
                  onClick={() => setMappingFor(item)}
                />
                <IconButton
                  icon={Pencil}
                  aria-label={t('editLabel')}
                  onClick={() => openEdit(item)}
                />
                <IconButton
                  icon={Trash2}
                  aria-label={t('deleteLabel')}
                  onClick={() => setPendingDelete(item)}
                />
              </div>
            ),
          },
        ]}
        rows={rows}
        total={rows.length}
        loading={categories.isPending}
        error={categories.error}
        onRetry={() => void categories.refetch()}
        page={1}
        pageSize={1000}
        onPageChange={() => undefined}
        rowKey={(item) => item.id}
        emptyTitle={t('empty')}
        toolbar={
          <>
            <div className="relative w-full max-w-xs">
              <Search
                size={16}
                aria-hidden
                className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-muted"
              />
              <Input
                aria-label={t('searchPlaceholder')}
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="ps-9"
              />
            </div>
            <Button className="ms-auto" onClick={() => openCreate(null)}>
              <Plus size={16} aria-hidden />
              {t('create')}
            </Button>
          </>
        }
      />

      <Modal
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        title={
          editor?.mode === 'edit'
            ? t('editTitle')
            : editor?.mode === 'create' && editor.parentId
              ? t('createSubTitle')
              : t('createTitle')
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <LocalizedTextFields
            labelFa={tForm('nameFa')}
            labelEn={tForm('nameEn')}
            faValue={form.nameFa}
            enValue={form.nameEn}
            onFaChange={(v) => set({ nameFa: v })}
            onEnChange={(v) => set({ nameEn: v })}
            faError={translateIssue(tRoot, errors.nameFa)}
          />
          <IconSelect
            value={form.icon}
            onChange={(v) => set({ icon: v })}
            kind="category"
            label={tForm('icon')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StringSelect
              id="kind"
              label={tForm('kind')}
              value={form.kind}
              onChange={(v) => set({ kind: v })}
              options={kindOptions}
            />
            <StringSelect
              id="color"
              label={tForm('color')}
              value={form.color}
              onChange={(v) => set({ color: v })}
              options={colorOptions}
            />
            <Field name="sortOrder" label={tForm('sortOrder')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={form.sortOrder}
                  onChange={(event) => set({ sortOrder: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field name="slug" label={tForm('slug')} hint={tForm('slugHint')}>
            {(props) => (
              <Input
                {...props}
                dir="ltr"
                value={form.slug}
                onChange={(event) => set({ slug: event.target.value })}
              />
            )}
          </Field>
          <Switch
            label={t('supportsReservation')}
            checked={form.supportsReservation}
            onChange={(checked) => set({ supportsReservation: checked })}
          />
          {editor?.mode === 'edit' ? (
            <Switch
              label={t('activeLabel')}
              checked={form.isActive}
              onChange={(checked) => set({ isActive: checked })}
            />
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
              {tForm('cancel')}
            </Button>
            <Button type="submit" disabled={createOne.isPending || updateOne.isPending}>
              {tForm('save')}
            </Button>
          </div>
        </form>
      </Modal>

      {mappingFor ? (
        <AmenitiesMappingModal category={mappingFor} onClose={() => setMappingFor(null)} />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('deleteTitle')}
        description={
          pendingDelete
            ? t('deleteBody', { name: pickName(pendingDelete.name, locale) })
            : undefined
        }
        confirmLabel={tForm('delete')}
        cancelLabel={tForm('cancel')}
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}

/**
 * The amenity ↔ category mapping dialog (B2.3 endpoints): a checkbox list of
 * every amenity with the category's current mapping pre-checked.
 */
export function AmenitiesMappingModal({
  category,
  onClose,
}: {
  category: AdminCategory;
  onClose: () => void;
}) {
  const t = useTranslations('admin.categories');
  const tForm = useTranslations('admin.form');
  const locale = useLocale();
  const toast = useToast();

  const amenities = useAdminAmenities();
  const mapped = useCategoryAmenityIds(category.id);
  const setMapping = useSetCategoryAmenities(category.id);

  const initial = useMemo(() => new Set(mapped.data?.items ?? []), [mapped.data]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const checked = selected ?? initial;

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    try {
      await setMapping.mutateAsync({ amenityIds: [...checked] });
      toast.success(t('amenitiesSaved'));
      onClose();
    } catch (err) {
      toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
    }
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={t('amenitiesTitle')} size="lg">
      {amenities.isPending || mapped.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ul className="max-h-80 space-y-1 overflow-y-auto" role="list">
            {(amenities.data ?? []).map((amenity: Amenity) => (
              <li key={amenity.id}>
                <Checkbox
                  label={pickName(amenity.name, locale)}
                  checked={checked.has(amenity.id)}
                  onChange={() => toggle(amenity.id)}
                />
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tForm('cancel')}
            </Button>
            <Button type="submit" disabled={setMapping.isPending}>
              {tForm('save')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
