'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Languages as LanguagesIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { Language } from '@app/contracts';
import {
  useAdminLanguages,
  useCreateLanguage,
  useDeleteLanguage,
  useUpdateLanguage,
} from '@/lib/api/admin-i18n';
import { AdminTable } from '@/components/admin/admin-table';
import { StringSelect, translateIssue } from '@/components/admin/admin-forms';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/form/switch';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api/errors';

interface LanguageFormState {
  code: string;
  nameNative: string;
  nameEn: string;
  dir: string;
  sortOrder: string;
  isActive: boolean;
  isDefault: boolean;
}

const EMPTY: LanguageFormState = {
  code: '',
  nameNative: '',
  nameEn: '',
  dir: 'rtl',
  sortOrder: '100',
  isActive: true,
  isDefault: false,
};

const dirOptions = [
  { value: 'rtl', label: 'RTL' },
  { value: 'ltr', label: 'LTR' },
];

const languageFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'admin.languages.codeFormat'),
  nameNative: z.string().trim().min(1, 'validation.required'),
  nameEn: z.string().trim().min(1, 'validation.required'),
  dir: z.enum(['rtl', 'ltr']),
  sortOrder: z.coerce.number({ message: 'validation.required' }).int().min(0).max(10_000),
});

type FormErrors = Partial<Record<keyof LanguageFormState, string>>;

/**
 * `/admin/languages` (F2.3) — the language registry over the B1.12 API:
 * create/edit modal, inline active toggle (the default language cannot be
 * deactivated — the switch is disabled and the server re-checks), atomic
 * default switch via `isDefault: true`, delete with confirm. Each language
 * links to its translation editor page.
 */
export function LanguagesAdmin() {
  const t = useTranslations('admin.languages');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const toast = useToast();

  const languages = useAdminLanguages();
  const createOne = useCreateLanguage();
  const updateOne = useUpdateLanguage();
  const deleteOne = useDeleteLanguage();

  const [editor, setEditor] = useState<
    { mode: 'create' } | { mode: 'edit'; item: Language } | null
  >(null);
  const [form, setForm] = useState<LanguageFormState>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pendingDelete, setPendingDelete] = useState<Language | null>(null);

  const set = (patch: Partial<LanguageFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const rows = useMemo(() => languages.data ?? [], [languages.data]);

  const openCreate = () => {
    setForm(EMPTY);
    setErrors({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (item: Language) => {
    setForm({
      code: item.code,
      nameNative: item.nameNative,
      nameEn: item.nameEn,
      dir: item.dir,
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
      isDefault: item.isDefault,
    });
    setErrors({});
    setEditor({ mode: 'edit', item });
  };

  const submit = async () => {
    if (!editor) return;
    const parsed = languageFormSchema.safeParse(form);
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
        await createOne.mutateAsync({
          code: form.code.trim(),
          nameNative: form.nameNative.trim(),
          nameEn: form.nameEn.trim(),
          dir: form.dir as Language['dir'],
          sortOrder: Number(form.sortOrder),
        });
        toast.success(t('created'));
      } else {
        await updateOne.mutateAsync({
          code: editor.item.code,
          body: {
            nameNative: form.nameNative.trim(),
            nameEn: form.nameEn.trim(),
            dir: form.dir as Language['dir'],
            sortOrder: Number(form.sortOrder),
            isActive: form.isActive,
            ...(form.isDefault && !editor.item.isDefault ? { isDefault: true } : {}),
          },
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
      await deleteOne.mutateAsync(pendingDelete.code);
      toast.success(t('deleted'));
    } catch (err) {
      toast.error(
        isApiRequestError(err) && err.isClientError ? t('deleteBlocked') : tForm('deleteFailed'),
      );
    } finally {
      setPendingDelete(null);
    }
  };

  const toggleActive = async (item: Language, isActive: boolean) => {
    try {
      await updateOne.mutateAsync({ code: item.code, body: { isActive } });
    } catch {
      toast.error(tForm('saveFailed'));
    }
  };

  return (
    <>
      <AdminTable<Language>
        columns={[
          {
            id: 'code',
            header: t('colCode'),
            cell: (item) => (
              <div>
                <span className="font-medium" dir="ltr">
                  {item.code}
                </span>
                {item.isDefault ? (
                  <Badge variant="neutral" className="ms-2 align-middle">
                    {t('defaultBadge')}
                  </Badge>
                ) : null}
              </div>
            ),
          },
          {
            id: 'name',
            header: t('colName'),
            cell: (item) => (
              <div>
                <span className="font-medium">{item.nameNative}</span>
                <span className="block text-xs text-text-subtle" dir="ltr">
                  {item.nameEn}
                </span>
              </div>
            ),
          },
          {
            id: 'dir',
            header: t('colDir'),
            cell: (item) => (
              <span className="inline-flex items-center gap-1 text-text-subtle">
                <LanguagesIcon size={14} aria-hidden />
                {item.dir.toUpperCase()}
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
                disabled={item.isDefault || updateOne.isPending}
                onChange={(checked) => void toggleActive(item, checked)}
              />
            ),
          },
          {
            id: 'actions',
            header: t('actionsLabel'),
            cell: (item) => (
              <div className="flex items-center gap-1">
                <Link
                  href={`/admin/languages/${item.code}`}
                  className="inline-flex h-9 items-center rounded-md px-2 text-sm text-text-subtle hover:bg-surface-alt hover:text-text"
                >
                  {t('translationsLink')}
                </Link>
                <IconButton
                  icon={Pencil}
                  aria-label={t('editLabel')}
                  onClick={() => openEdit(item)}
                />
                {item.code === 'fa' || item.isDefault ? null : (
                  <IconButton
                    icon={Trash2}
                    aria-label={t('deleteLabel')}
                    onClick={() => setPendingDelete(item)}
                  />
                )}
              </div>
            ),
          },
        ]}
        rows={rows}
        total={rows.length}
        loading={languages.isPending}
        error={languages.error}
        onRetry={() => void languages.refetch()}
        page={1}
        pageSize={1000}
        onPageChange={() => undefined}
        rowKey={(item) => item.code}
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
        title={editor?.mode === 'edit' ? t('editTitle') : t('createTitle')}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            name="code"
            label={tForm('code')}
            hint={tForm('codeHint')}
            error={translateIssue(tRoot, errors.code)}
          >
            {(props) => (
              <Input
                {...props}
                dir="ltr"
                maxLength={5}
                disabled={editor?.mode === 'edit'}
                value={form.code}
                onChange={(event) => set({ code: event.target.value })}
              />
            )}
          </Field>
          <Field
            name="nameNative"
            label={tForm('nameNative')}
            error={translateIssue(tRoot, errors.nameNative)}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={form.nameNative}
                onChange={(event) => set({ nameNative: event.target.value })}
              />
            )}
          </Field>
          <Field
            name="nameEn"
            label={tForm('nameEn')}
            error={translateIssue(tRoot, errors.nameEn)}
            required
          >
            {(props) => (
              <Input
                {...props}
                dir="ltr"
                value={form.nameEn}
                onChange={(event) => set({ nameEn: event.target.value })}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StringSelect
              id="dir"
              label={tForm('dir')}
              value={form.dir}
              onChange={(v) => set({ dir: v })}
              options={dirOptions}
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
          {editor?.mode === 'edit' ? (
            <>
              <Switch
                label={t('activeLabel')}
                checked={form.isActive}
                disabled={editor.item.isDefault}
                onChange={(checked) => set({ isActive: checked })}
              />
              {editor.item.isDefault ? null : (
                <Switch
                  label={t('makeDefault')}
                  checked={form.isDefault}
                  onChange={(checked) => set({ isDefault: checked })}
                />
              )}
            </>
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
          pendingDelete ? t('deleteBody', { name: pendingDelete.nameNative }) : undefined
        }
        confirmLabel={tForm('delete')}
        cancelLabel={tForm('cancel')}
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
