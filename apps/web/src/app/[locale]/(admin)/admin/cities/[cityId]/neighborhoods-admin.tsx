'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { AdminCity, Neighborhood } from '@app/contracts';
import {
  useAdminCities,
  useAdminNeighborhoods,
  useCreateNeighborhood,
  useDeleteNeighborhood,
  useUpdateNeighborhood,
} from '@/lib/api/admin-catalog';
import { AdminTable } from '@/components/admin/admin-table';
import { LocalizedTextFields, NumberField, translateIssue } from '@/components/admin/admin-forms';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/form/switch';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { toDisplayDigits } from '@/lib/forms/digits';
import { isApiRequestError } from '@/lib/api/errors';
import { pickName } from '../cities-admin';

interface NeighborhoodFormState {
  nameFa: string;
  nameEn: string;
  lat: string;
  lng: string;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY: NeighborhoodFormState = {
  nameFa: '',
  nameEn: '',
  lat: '',
  lng: '',
  isActive: true,
  sortOrder: '100',
};

const neighborhoodFormSchema = z.object({
  nameFa: z.string().trim().min(1, 'validation.required'),
  nameEn: z.string().trim(),
  lat: z.coerce.number({ message: 'validation.required' }).min(-90).max(90),
  lng: z.coerce.number({ message: 'validation.required' }).min(-180).max(180),
  sortOrder: z.coerce.number({ message: 'validation.required' }).int(),
});

type FormErrors = Partial<Record<keyof NeighborhoodFormState, string>>;

function bodyFromForm(form: NeighborhoodFormState) {
  return {
    name: {
      fa: form.nameFa.trim(),
      ...(form.nameEn.trim() ? { en: form.nameEn.trim() } : {}),
    },
    center: { lat: Number(form.lat), lng: Number(form.lng) },
    isActive: form.isActive,
    sortOrder: Number(form.sortOrder),
  };
}

/**
 * `/admin/cities/[cityId]` (F2.2) — the neighborhoods of one city: create/
 * edit modal, inline active toggle, delete. The city display name resolves
 * from the cached admin cities list (the neighborhoods API has no single
 * city endpoint; the list is already fresh from the index page).
 */
export function NeighborhoodsAdmin({ cityId }: { cityId: string }) {
  const t = useTranslations('admin.neighborhoods');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const toast = useToast();
  const locale = useLocale();

  const cities = useAdminCities();
  const neighborhoods = useAdminNeighborhoods(cityId);
  const createOne = useCreateNeighborhood(cityId);
  const updateOne = useUpdateNeighborhood(cityId);
  const deleteOne = useDeleteNeighborhood(cityId);

  const city = useMemo<AdminCity | null>(
    () => cities.data?.find((c) => c.id === cityId) ?? null,
    [cities.data, cityId],
  );

  const [editor, setEditor] = useState<
    { mode: 'create' } | { mode: 'edit'; item: Neighborhood } | null
  >(null);
  const [form, setForm] = useState<NeighborhoodFormState>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pendingDelete, setPendingDelete] = useState<Neighborhood | null>(null);

  const set = (patch: Partial<NeighborhoodFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const rows = useMemo(() => neighborhoods.data ?? [], [neighborhoods.data]);

  const openCreate = () => {
    setForm(EMPTY);
    setErrors({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (item: Neighborhood) => {
    setForm({
      nameFa: item.name.fa ?? '',
      nameEn: item.name.en ?? '',
      lat: String(item.center.lat),
      lng: String(item.center.lng),
      isActive: item.isActive,
      sortOrder: String(item.sortOrder),
    });
    setErrors({});
    setEditor({ mode: 'edit', item });
  };

  const submit = async () => {
    if (!editor) return;
    const parsed = neighborhoodFormSchema.safeParse(form);
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
    try {
      if (editor.mode === 'create') {
        await createOne.mutateAsync(bodyFromForm(form));
        toast.success(t('created'));
      } else {
        await updateOne.mutateAsync({ id: editor.item.id, body: bodyFromForm(form) });
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
      toast.error(isApiRequestError(err) ? err.message : tForm('deleteFailed'));
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <>
      <AdminTable<Neighborhood>
        columns={[
          {
            id: 'name',
            header: t('colName'),
            sortable: true,
            cell: (item) => (
              <div>
                <span className="font-medium">{pickName(item.name, locale)}</span>
                <span className="block text-xs text-text-subtle" dir="ltr">
                  {item.slug}
                </span>
              </div>
            ),
          },
          {
            id: 'center',
            header: t('colCenter'),
            cell: (item) => (
              <span className="text-text-subtle" dir="ltr">
                {toDisplayDigits(item.center.lat.toFixed(4), locale)},{' '}
                {toDisplayDigits(item.center.lng.toFixed(4), locale)}
              </span>
            ),
          },
          {
            id: 'active',
            header: t('activeLabel'),
            cell: (item) => <ActiveCell item={item} t={t} />,
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
        loading={neighborhoods.isPending || cities.isPending}
        error={neighborhoods.error}
        onRetry={() => void neighborhoods.refetch()}
        page={1}
        pageSize={1000}
        onPageChange={() => undefined}
        rowKey={(item) => item.id}
        emptyTitle={t('empty')}
        toolbar={
          <Button className="ms-auto" onClick={openCreate}>
            <Plus size={16} aria-hidden />
            {t('create')}
          </Button>
        }
      />

      <Modal
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        title={
          editor?.mode === 'edit'
            ? t('editTitle')
            : t('createTitle', { city: city ? pickName(city.name, locale) : '…' })
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberField
              name="lat"
              label={tForm('lat')}
              value={form.lat}
              onChange={(v) => set({ lat: v })}
              error={translateIssue(tRoot, errors.lat)}
            />
            <NumberField
              name="lng"
              label={tForm('lng')}
              value={form.lng}
              onChange={(v) => set({ lng: v })}
              error={translateIssue(tRoot, errors.lng)}
            />
          </div>
          <SortOrderField
            value={form.sortOrder}
            onChange={(v) => set({ sortOrder: v })}
            label={tForm('sortOrder')}
          />
          <Switch
            label={t('activeLabel')}
            checked={form.isActive}
            onChange={(checked) => set({ isActive: checked })}
          />
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

/** Inline active toggle kept out of the row render to bound re-renders. */
function ActiveCell({ item, t }: { item: Neighborhood; t: ReturnType<typeof useTranslations> }) {
  const updateOne = useUpdateNeighborhood(item.cityId);
  const toast = useToast();
  const tForm = useTranslations('admin.form');
  return (
    <Switch
      label={<span className="sr-only">{t('activeLabel')}</span>}
      checked={item.isActive}
      disabled={updateOne.isPending}
      onChange={(checked) => {
        updateOne.mutate(
          { id: item.id, body: { isActive: checked } },
          {
            onSuccess: () => toast.success(t('updated')),
            onError: () => toast.error(tForm('saveFailed')),
          },
        );
      }}
    />
  );
}

/** The numeric sort-order field, shared by create/edit. */
function SortOrderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const tForm = useTranslations('admin.form');
  return (
    <Field name="sortOrder" label={label} hint={tForm('sortOrderHint')}>
      {(props) => (
        <Input
          {...props}
          type="number"
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
