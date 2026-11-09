'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { AMENITY_GROUPS, amenityGroupSchema, type Amenity } from '@app/contracts';
import {
  useAdminAmenities,
  useCreateAmenity,
  useDeleteAmenity,
  useUpdateAmenity,
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
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/form/switch';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api/errors';
import { pickName } from '../cities/cities-admin';

interface AmenityFormState {
  nameFa: string;
  nameEn: string;
  slug: string;
  icon: string;
  group: string;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY: AmenityFormState = {
  nameFa: '',
  nameEn: '',
  slug: '',
  icon: 'wifi',
  group: 'general',
  isActive: true,
  sortOrder: '100',
};

const groupOptions = amenityGroupSchema.options.map((g) => ({ value: g, label: g }));

const amenityFormSchema = z.object({
  nameFa: z.string().trim().min(1, 'validation.required'),
  nameEn: z.string().trim(),
  slug: z
    .string()
    .trim()
    .regex(/^$|^[a-z0-9][a-z0-9-]*$/, 'admin.form.slugFormat'),
  icon: z.string().min(1, 'validation.required'),
  group: z.enum(AMENITY_GROUPS),
  sortOrder: z.coerce.number({ message: 'validation.required' }).int(),
});

type FormErrors = Partial<Record<keyof AmenityFormState, string>>;

/**
 * `/admin/amenities` (F2.2) — the flat amenity catalog: create/edit modal,
 * inline active toggle, delete. The category mapping lives on the categories
 * page (per-category dialog).
 */
export function AmenitiesAdmin() {
  const t = useTranslations('admin.amenities');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const toast = useToast();
  const locale = useLocale();

  const amenities = useAdminAmenities();
  const createOne = useCreateAmenity();
  const updateOne = useUpdateAmenity();
  const deleteOne = useDeleteAmenity();

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; item: Amenity } | null>(
    null,
  );
  const [form, setForm] = useState<AmenityFormState>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pendingDelete, setPendingDelete] = useState<Amenity | null>(null);

  const set = (patch: Partial<AmenityFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const rows = useMemo(() => {
    const list = amenities.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        (a.name.fa ?? '').toLowerCase().includes(q) ||
        (a.name.en ?? '').toLowerCase().includes(q) ||
        a.slug.includes(q),
    );
  }, [amenities.data, search]);

  const openCreate = () => {
    setForm(EMPTY);
    setErrors({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (item: Amenity) => {
    setForm({
      nameFa: item.name.fa ?? '',
      nameEn: item.name.en ?? '',
      slug: item.slug,
      icon: item.icon,
      group: item.group,
      isActive: item.isActive,
      sortOrder: String(item.sortOrder),
    });
    setErrors({});
    setEditor({ mode: 'edit', item });
  };

  const submit = async () => {
    if (!editor) return;
    const parsed = amenityFormSchema.safeParse(form);
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
    const common = {
      name: {
        fa: form.nameFa.trim(),
        ...(form.nameEn.trim() ? { en: form.nameEn.trim() } : {}),
      },
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      icon: form.icon as Amenity['icon'],
      group: form.group as Amenity['group'],
      sortOrder: Number(form.sortOrder),
    };
    try {
      if (editor.mode === 'create') {
        await createOne.mutateAsync(common);
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

  const toggleActive = async (item: Amenity, isActive: boolean) => {
    try {
      await updateOne.mutateAsync({ id: item.id, body: { isActive } });
    } catch {
      toast.error(tForm('saveFailed'));
    }
  };

  return (
    <>
      <AdminTable<Amenity>
        columns={[
          {
            id: 'name',
            header: t('colName'),
            cell: (item) => {
              const Icon = iconByName(item.icon);
              return (
                <div>
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
            id: 'group',
            header: t('colGroup'),
            cell: (item) => <span className="text-text-subtle">{t(`group.${item.group}`)}</span>,
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
        loading={amenities.isPending}
        error={amenities.error}
        onRetry={() => void amenities.refetch()}
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
            <Button className="ms-auto" onClick={openCreate}>
              <Plus size={16} aria-hidden />
              {t('create')}
            </Button>
          </>
        }
      />

      <Modal
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        title={editor?.mode === 'edit' ? t('editTitle') : t('createTitle')}
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
            kind="amenity"
            label={tForm('icon')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StringSelect
              id="group"
              label={tForm('group')}
              value={form.group}
              onChange={(v) => set({ group: v })}
              options={groupOptions}
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
          </div>
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
