'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save, Search } from 'lucide-react';
import { z } from 'zod';
import type { AdminTranslationRow, Language } from '@app/contracts';
import { useAdminTranslations, useUpsertTranslations } from '@/lib/api/admin-i18n';
import { AdminTable } from '@/components/admin/admin-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/form/switch';
import { useToast } from '@/components/ui/toast';
import { toDisplayDigits } from '@/lib/forms/digits';
import { isApiRequestError } from '@/lib/api/errors';

const PAGE_SIZE = 25;

const searchSchema = z.string().trim().max(200, 'admin.translations.tooLong');

type DirtyMap = Record<string, string>;

/**
 * `/admin/languages/[code]` translation editor (F2.3) — server-paginated
 * key list for one locale with the default-locale reference beside each
 * row. Edits accumulate in a dirty map; one «ذخیره» PUT upserts ONLY the
 * dirty entries (≤500 per request per the B1.12 contract). Search (q) and
 * the missing-only filter re-query the server.
 */
export function TranslationsEditor({ language }: { language: Language }) {
  const t = useTranslations('admin.translations');
  const tForm = useTranslations('admin.form');
  const toast = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [dirty, setDirty] = useState<DirtyMap>({});

  const filter = useMemo(
    () => ({ q: search || undefined, missing: missingOnly, page, pageSize: PAGE_SIZE }),
    [search, missingOnly, page],
  );

  const translations = useAdminTranslations(language.code, filter);
  const upsert = useUpsertTranslations(language.code);

  const rows = useMemo(() => translations.data?.items ?? [], [translations.data]);
  const meta = translations.data?.meta;
  const dirtyCount = Object.keys(dirty).length;

  const applySearch = () => {
    const parsed = searchSchema.safeParse(searchInput);
    if (!parsed.success) {
      toast.error(t('tooLong'));
      return;
    }
    setPage(1);
    setSearch(parsed.data);
  };

  const markDirty = (key: string, value: string) => {
    setDirty((prev) => {
      const original = rows.find((r) => r.key === key)?.value ?? '';
      if (value === original) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const save = async () => {
    const entries = Object.entries(dirty).map(([key, value]) => ({ key, value }));
    if (entries.length === 0) return;
    try {
      const result = await upsert.mutateAsync(entries);
      toast.success(t('saved', { count: toDisplayDigits(String(result.saved), 'fa') }));
      setDirty({});
    } catch (err) {
      toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
    }
  };

  return (
    <AdminTable<AdminTranslationRow>
      columns={[
        {
          id: 'key',
          header: t('colKey'),
          cell: (row) => (
            <span className="block max-w-56 truncate font-mono text-xs" dir="ltr" title={row.key}>
              {row.key}
            </span>
          ),
        },
        {
          id: 'default',
          header: t('colDefault'),
          cell: (row) => (
            <span
              className="block max-w-56 truncate text-text-subtle"
              title={row.defaultValue ?? ''}
            >
              {row.defaultValue ?? '—'}
            </span>
          ),
        },
        {
          id: 'value',
          header: t('colValue'),
          cell: (row) => (
            <Input
              aria-label={`${t('colValue')}: ${row.key}`}
              dir={language.dir}
              value={dirty[row.key] ?? row.value ?? ''}
              onChange={(event) => markDirty(row.key, event.target.value)}
            />
          ),
        },
      ]}
      rows={rows}
      total={meta?.total ?? 0}
      loading={translations.isPending}
      error={translations.error}
      onRetry={() => void translations.refetch()}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      rowKey={(row) => row.key}
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
              dir="ltr"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applySearch();
                }
              }}
              className="ps-9"
            />
          </div>
          <Switch
            label={t('missingOnly')}
            checked={missingOnly}
            onChange={(checked) => {
              setPage(1);
              setMissingOnly(checked);
            }}
          />
          <Button
            className="ms-auto"
            onClick={() => void save()}
            disabled={dirtyCount === 0 || upsert.isPending}
          >
            <Save size={16} aria-hidden />
            {dirtyCount > 0
              ? t('saveDirty', { count: toDisplayDigits(String(dirtyCount), 'fa') })
              : t('save')}
          </Button>
        </>
      }
    />
  );
}
