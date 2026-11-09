'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Palette } from 'lucide-react';
import type { ThemePreview } from '@app/contracts';
import { useSetActiveTheme, useThemePacks } from '@/lib/api/admin-theme';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { pickName } from '../cities/cities-admin';

/**
 * `/admin/theme` (F2.4) — the theme-pack gallery over the B1.13 API: each
 * seeded pack renders as a card with its 5-color light/dark preview swatches
 * and an activate action (`PUT /admin/theme/active`). Switching applies
 * site-wide: the public app's SSR theme revalidates under its own cache key.
 * The per-pack token editor (`PUT /admin/theme/packs/:id`) is F10.4 scope —
 * this page ships the switch.
 */
export function ThemeAdmin() {
  const t = useTranslations('admin.theme');
  const locale = useLocale();
  const toast = useToast();

  const packs = useThemePacks();
  const setActive = useSetActiveTheme();
  const [pending, setPending] = useState<ThemePreview | null>(null);

  const confirmActivate = async () => {
    if (!pending) return;
    try {
      await setActive.mutateAsync(pending.id);
      toast.success(t('activated', { name: pickName(pending.names, locale) }));
    } catch {
      toast.error(t('activateFailed'));
    } finally {
      setPending(null);
    }
  };

  if (packs.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    );
  }

  if (packs.error) {
    return <ErrorState error={packs.error} onRetry={() => void packs.refetch()} />;
  }

  const items = packs.data ?? [];

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
        {items.map((pack) => {
          const isPendingPack = setActive.isPending && pending?.id === pack.id;
          return (
            <li
              key={pack.id}
              className="rounded-lg border border-border-subtle p-4"
              aria-current={pack.isActive ? 'true' : undefined}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-medium text-text">
                  <Palette size={16} aria-hidden className="text-muted" />
                  {pickName(pack.names, locale)}
                  <span className="text-xs text-muted" dir="ltr">
                    v{pack.version}
                  </span>
                </h3>
                {pack.isActive ? <Badge variant="neutral">{t('activeBadge')}</Badge> : null}
              </div>
              <SwatchRow label={t('previewLight')} colors={pack.preview.light} />
              <SwatchRow label={t('previewDark')} colors={pack.preview.dark} />
              <div className="mt-4">
                {pack.isActive ? (
                  <Button variant="ghost" size="sm" disabled aria-disabled>
                    <Check size={14} aria-hidden />
                    {t('activeBadge')}
                  </Button>
                ) : (
                  <Button size="sm" disabled={isPendingPack} onClick={() => setPending(pack)}>
                    {t('activate')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('activateTitle')}
        description={
          pending ? t('activateBody', { name: pickName(pending.names, locale) }) : undefined
        }
        confirmLabel={t('activate')}
        cancelLabel={t('cancel')}
        onConfirm={confirmActivate}
      />
    </>
  );
}

function SwatchRow({
  label,
  colors,
}: {
  label: string;
  colors: readonly [string, string, string, string, string];
}) {
  const t = useTranslations('admin.theme');
  return (
    <div className="mb-2">
      <p className="mb-1 text-xs text-text-subtle">{label}</p>
      <div className={cn('flex gap-1')} role="img" aria-label={t('previewAlt', { mode: label })}>
        {colors.map((color, i) => (
          <span
            key={i}
            title={color}
            className="h-8 flex-1 rounded-md border border-border-subtle"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}
