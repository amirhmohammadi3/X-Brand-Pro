'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { AdminCity, LocalizedText } from '@app/contracts';
import {
  useAdminCities,
  useCreateCity,
  useDeleteCity,
  useSetCityActive,
  useUpdateCity,
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

/** Pick the display name from a LocalizedText (current locale, fa fallback). */
export function pickName(text: LocalizedText, locale: string): string {
  return text[locale as keyof LocalizedText] ?? text.fa ?? '';
}

interface CityFormState {
  nameFa: string;
  nameEn: string;
  slug: string;
  lat: string;
  lng: string;
  west: string;
  south: string;
  east: string;
  north: string;
  timezone: string;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY_CITY: CityFormState = {
  nameFa: '',
  nameEn: '',
  slug: '',
  lat: '',
  lng: '',
  west: '',
  south: '',
  east: '',
  north: '',
  timezone: 'Asia/Tehran',
  isActive: true,
  sortOrder: '100',
};

const EMPTY_BBOX = { west: 0, south: 0, east: 0, north: 0 };

const cityFormSchema = z
  .object({
    nameFa: z.string().trim().min(1, 'validation.required'),
    nameEn: z.string().trim(),
    slug: z
      .string()
      .trim()
      .regex(/^$|^[a-z0-9][a-z0-9-]*$/, 'admin.form.slugFormat'),
    lat: z.coerce.number({ message: 'validation.required' }).min(-90).max(90),
    lng: z.coerce.number({ message: 'validation.required' }).min(-180).max(180),
    west: z.coerce.number({ message: 'validation.required' }).min(-180).max(180),
    south: z.coerce.number({ message: 'validation.required' }).min(-90).max(90),
    east: z.coerce.number({ message: 'validation.required' }).min(-180).max(180),
    north: z.coerce.number({ message: 'validation.required' }).min(-90).max(90),
    timezone: z.string().trim().min(1, 'validation.required'),
    sortOrder: z.coerce.number({ message: 'validation.required' }).int(),
  })
  .refine(
    (v) =>
      (v.west === EMPTY_BBOX.west && v.south === 0 && v.east === 0 && v.north === 0) ||
      (v.west < v.east && v.south < v.north),
    { message: 'admin.cities.bboxOrder', path: ['west'] },
  )
  .refine(
    (v) =>
      (v.west === EMPTY_BBOX.west && v.south === 0 && v.east === 0 && v.north === 0) ||
      (v.lng >= v.west && v.lng <= v.east && v.lat >= v.south && v.lat <= v.north),
    { message: 'admin.cities.centerOutside', path: ['lat'] },
  );

type CityFormErrors = Partial<Record<keyof CityFormState, string>>;

function bodyFromForm(form: CityFormState) {
  const w = Number(form.west || 0);
  const s = Number(form.south || 0);
  const e = Number(form.east || 0);
  const n = Number(form.north || 0);
  const hasBbox = !(w === 0 && s === 0 && e === 0 && n === 0);
  return {
    name: {
      fa: form.nameFa.trim(),
      ...(form.nameEn.trim() ? { en: form.nameEn.trim() } : {}),
    },
    ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
    center: { lat: Number(form.lat), lng: Number(form.lng) },
    bbox: hasBbox ? { west: w, south: s, east: e, north: n } : null,
    timezone: form.timezone.trim(),
    isActive: form.isActive,
    sortOrder: Number(form.sortOrder),
  };
}

/**
 * `/admin/cities` (F2.2) — the city list with a create/edit modal, an inline
 * active toggle, delete confirmation and a per-city neighborhoods link.
 * Lists load whole (a handful of cities — no pagination); search filters
 * client-side by fa/en name and slug.
 */
export function CitiesAdmin() {
  const t = useTranslations('admin.cities');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const toast = useToast();
  const locale = useLocale();

  const cities = useAdminCities();
  const createCity = useCreateCity();
  const updateCity = useUpdateCity();
  const deleteCity = useDeleteCity();
  const setActive = useSetCityActive();

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<
    { mode: 'create' } | { mode: 'edit'; city: AdminCity } | null
  >(null);
  const [form, setForm] = useState<CityFormState>(EMPTY_CITY);
  const [errors, setErrors] = useState<CityFormErrors>({});
  const [pendingDelete, setPendingDelete] = useState<AdminCity | null>(null);

  const set = (patch: Partial<CityFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const rows = useMemo(() => {
    const list = cities.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.name.fa ?? '').toLowerCase().includes(q) ||
        (c.name.en ?? '').toLowerCase().includes(q) ||
        c.slug.includes(q),
    );
  }, [cities.data, search]);

  const openCreate = () => {
    setForm(EMPTY_CITY);
    setErrors({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (city: AdminCity) => {
    setForm({
      nameFa: city.name.fa ?? '',
      nameEn: city.name.en ?? '',
      slug: city.slug,
      lat: String(city.center.lat),
      lng: String(city.center.lng),
      west: city.bbox ? String(city.bbox.west) : '',
      south: city.bbox ? String(city.bbox.south) : '',
      east: city.bbox ? String(city.bbox.east) : '',
      north: city.bbox ? String(city.bbox.north) : '',
      timezone: city.timezone,
      isActive: city.isActive,
      sortOrder: String(city.sortOrder),
    });
    setErrors({});
    setEditor({ mode: 'edit', city });
  };

  const submit = async () => {
    if (!editor) return;
    const parsed = cityFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: CityFormErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string') {
          const existing = next[key as keyof CityFormErrors];
          if (!existing) next[key as keyof CityFormErrors] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    const body = bodyFromForm(form);
    try {
      if (editor.mode === 'create') {
        await createCity.mutateAsync(body);
        toast.success(t('created'));
      } else {
        await updateCity.mutateAsync({ id: editor.city.id, body });
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
      await deleteCity.mutateAsync(pendingDelete.id);
      toast.success(t('deleted'));
    } catch (err) {
      // The API refuses with 422 while the city still has businesses.
      toast.error(
        isApiRequestError(err) && err.isClientError ? t('deleteBlocked') : tForm('deleteFailed'),
      );
    } finally {
      setPendingDelete(null);
    }
  };

  const toggleActive = async (city: AdminCity, isActive: boolean) => {
    try {
      await setActive.mutateAsync({ id: city.id, isActive });
    } catch {
      toast.error(tForm('saveFailed'));
    }
  };

  return (
    <>
      <AdminTable<AdminCity>
        columns={[
          {
            id: 'name',
            header: t('colName'),
            sortable: true,
            cell: (city) => (
              <div>
                <span className="font-medium">{pickName(city.name, locale)}</span>
                <span className="block text-xs text-text-subtle" dir="ltr">
                  {city.slug}
                </span>
              </div>
            ),
          },
          {
            id: 'counts',
            header: t('colCounts'),
            cell: (city) => (
              <span className="text-text-subtle">
                {t('neighborhoodCount', {
                  count: toDisplayDigits(String(city.neighborhoodCount), locale),
                })}
                {' · '}
                {t('businessCount', {
                  count: toDisplayDigits(String(city.businessCount), locale),
                })}
              </span>
            ),
          },
          {
            id: 'active',
            header: t('activeLabel'),
            cell: (city) => (
              <Switch
                label={<span className="sr-only">{t('activeLabel')}</span>}
                checked={city.isActive}
                disabled={setActive.isPending}
                onChange={(checked) => void toggleActive(city, checked)}
              />
            ),
          },
          {
            id: 'actions',
            header: t('actionsLabel'),
            cell: (city) => (
              <div className="flex items-center gap-1">
                <Link
                  href={`/admin/cities/${city.id}`}
                  aria-label={t('neighborhoodsLink')}
                  title={t('neighborhoodsLink')}
                  className="inline-flex h-9 items-center rounded-md px-2 text-text-subtle hover:bg-surface-alt hover:text-text"
                >
                  <MapPin size={16} aria-hidden />
                </Link>
                <IconButton
                  icon={Pencil}
                  aria-label={t('editLabel')}
                  onClick={() => openEdit(city)}
                />
                <IconButton
                  icon={Trash2}
                  aria-label={t('deleteLabel')}
                  onClick={() => setPendingDelete(city)}
                />
              </div>
            ),
          },
        ]}
        rows={rows}
        total={rows.length}
        loading={cities.isPending}
        error={cities.error}
        onRetry={() => void cities.refetch()}
        page={1}
        pageSize={1000}
        onPageChange={() => undefined}
        rowKey={(city) => city.id}
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
        size="lg"
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NumberField
              name="west"
              label={tForm('west')}
              value={form.west}
              onChange={(v) => set({ west: v })}
              error={translateIssue(tRoot, errors.west)}
            />
            <NumberField
              name="south"
              label={tForm('south')}
              value={form.south}
              onChange={(v) => set({ south: v })}
            />
            <NumberField
              name="east"
              label={tForm('east')}
              value={form.east}
              onChange={(v) => set({ east: v })}
            />
            <NumberField
              name="north"
              label={tForm('north')}
              value={form.north}
              onChange={(v) => set({ north: v })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            <Field name="timezone" label={tForm('timezone')}>
              {(props) => (
                <Input
                  {...props}
                  dir="ltr"
                  value={form.timezone}
                  onChange={(event) => set({ timezone: event.target.value })}
                />
              )}
            </Field>
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
          <Switch
            label={t('activeLabel')}
            checked={form.isActive}
            onChange={(checked) => set({ isActive: checked })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
              {tForm('cancel')}
            </Button>
            <Button type="submit" disabled={createCity.isPending || updateCity.isPending}>
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
