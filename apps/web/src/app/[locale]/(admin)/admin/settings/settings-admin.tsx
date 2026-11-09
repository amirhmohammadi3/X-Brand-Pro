'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, Pencil, Search } from 'lucide-react';
import type { AdminSetting } from '@app/contracts';
import { useAdminSettings, useUpdateSetting } from '@/lib/api/admin-theme';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/form/switch';
import { Modal } from '@/components/ui/modal';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { toDisplayDigits } from '@/lib/forms/digits';
import { isApiRequestError } from '@/lib/api/errors';

/**
 * `/admin/settings` (F2.4) — the settings-registry skeleton over the
 * B1.1/B1.11 API: one section per group, every key rendered with its
 * (masked) value, `isDefault`/`isSecret` badges and an edit modal. Values
 * edit by primitive kind (boolean → switch, number → number input, string →
 * text, object → JSON textarea); secrets are WRITE-ONLY (empty = keep, a
 * «حذف بازنویسی» checkbox sends `clear: true` to fall back to the registry
 * default). Provider credentials and SMTP/SMS keys all flow through here.
 */
export function SettingsAdmin() {
  const t = useTranslations('admin.settings');
  const tForm = useTranslations('admin.form');
  const toast = useToast();

  const settings = useAdminSettings();
  const updateOne = useUpdateSetting();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminSetting | null>(null);

  const groups = useMemo(() => {
    const all = settings.data?.groups ?? {};
    const q = search.trim().toLowerCase();
    if (!q) return all;
    const filtered: Record<string, AdminSetting[]> = {};
    for (const [group, items] of Object.entries(all)) {
      const hits = items.filter(
        (s) => s.key.toLowerCase().includes(q) || group.toLowerCase().includes(q),
      );
      if (hits.length > 0) filtered[group] = hits;
    }
    return filtered;
  }, [settings.data, search]);

  const groupNames = Object.keys(groups).sort();

  if (settings.isPending) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (settings.error) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ps-9"
          />
        </div>
      </div>

      {groupNames.length === 0 ? <p className="text-text-subtle">{t('empty')}</p> : null}

      <div className="space-y-6">
        {groupNames.map((group) => (
          <section key={group} aria-labelledby={`settings-${group}`}>
            <h2
              id={`settings-${group}`}
              className="mb-2 text-sm font-medium uppercase tracking-wide text-muted"
            >
              {group}
              <span className="ms-2 text-xs normal-case text-text-subtle">
                {t('keyCount', {
                  count: toDisplayDigits(String(groups[group]?.length ?? 0), 'fa'),
                })}
              </span>
            </h2>
            <ul
              className="divide-y divide-border-subtle rounded-lg border border-border-subtle"
              role="list"
            >
              {(groups[group] ?? []).map((setting) => (
                <li key={setting.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate font-mono text-xs"
                      dir="ltr"
                      title={setting.key}
                    >
                      {setting.key}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-text-subtle">
                      {setting.isSecret ? (
                        <Badge variant="neutral">{t('secretBadge')}</Badge>
                      ) : null}
                      {setting.isDefault ? (
                        <Badge variant="neutral">{t('defaultBadge')}</Badge>
                      ) : null}
                      <span dir="ltr">{describeValue(setting)}</span>
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(setting)}
                    aria-label={`${t('editLabel')}: ${setting.key}`}
                  >
                    <Pencil size={14} aria-hidden />
                    {t('editLabel')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {editing ? (
        <SettingEditModal
          setting={editing}
          onClose={() => setEditing(null)}
          onSave={async (value, clear) => {
            try {
              await updateOne.mutateAsync({ key: editing.key, value, clear });
              toast.success(t('saved', { key: editing.key }));
              setEditing(null);
            } catch (err) {
              toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
            }
          }}
        />
      ) : null}
    </>
  );
}

function describeValue(setting: AdminSetting): string {
  if (setting.isSecret) return '••••••';
  const value = setting.value;
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The value editor for one registry key. */
function SettingEditModal({
  setting,
  onClose,
  onSave,
}: {
  setting: AdminSetting;
  onClose: () => void;
  onSave: (value: unknown, clear?: boolean) => Promise<void>;
}) {
  const t = useTranslations('admin.settings');
  const tForm = useTranslations('admin.form');
  const toast = useToast();
  const updateOne = useUpdateSetting();
  const [text, setText] = useState(() => {
    if (setting.isSecret) return '';
    const v = setting.value;
    if (typeof v === 'object' && v !== null) return JSON.stringify(v, null, 2);
    return v === null || v === undefined ? '' : String(v);
  });
  const [boolValue, setBoolValue] = useState(setting.value === true);
  const [clear, setClear] = useState(false);

  const isBoolean = typeof setting.value === 'boolean' && !setting.isSecret;
  const isNumber = typeof setting.value === 'number' && !setting.isSecret;
  const isObject = typeof setting.value === 'object' && setting.value !== null && !setting.isSecret;

  const submit = async () => {
    if (clear) {
      await onSave('', true);
      return;
    }
    if (isBoolean) {
      await onSave(boolValue);
      return;
    }
    if (isNumber) {
      const parsed = Number(text);
      if (Number.isNaN(parsed)) {
        toast.error(t('invalidNumber'));
        return;
      }
      await onSave(parsed);
      return;
    }
    if (isObject) {
      try {
        await onSave(JSON.parse(text));
      } catch {
        toast.error(t('invalidJson'));
      }
      return;
    }
    // String or secret: secrets send '' meaning "keep unchanged" unless
    // cleared — the server rejects an empty secret without `clear`.
    await onSave(text);
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="flex items-center gap-2 font-mono text-sm" dir="ltr">
          <KeyRound size={14} aria-hidden className="text-muted" />
          {setting.key}
        </span>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {setting.isSecret ? <p className="text-xs text-text-subtle">{t('secretHint')}</p> : null}

        {isBoolean ? (
          <Switch
            label={t('valueLabel')}
            checked={boolValue}
            onChange={setBoolValue}
            disabled={clear}
          />
        ) : isObject ? (
          <Field name="value" label={t('valueLabel')} hint={t('jsonHint')}>
            {(props) => (
              <textarea
                {...props}
                dir="ltr"
                rows={6}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs"
                value={text}
                disabled={clear}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </Field>
        ) : (
          <Field
            name="value"
            label={t('valueLabel')}
            hint={setting.isSecret ? t('secretHint') : undefined}
          >
            {(props) => (
              <Input
                {...props}
                dir="ltr"
                type={setting.isSecret ? 'password' : isNumber ? 'number' : 'text'}
                value={text}
                disabled={clear}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </Field>
        )}

        {setting.isDefault ? null : (
          <Switch
            label={t('clearOverride')}
            description={t('clearOverrideHint')}
            checked={clear}
            onChange={setClear}
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tForm('cancel')}
          </Button>
          <Button type="submit" disabled={updateOne.isPending}>
            {tForm('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
