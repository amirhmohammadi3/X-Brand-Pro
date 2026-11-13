'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { AuthProvider } from '../../../lib/auth/auth-context';
import { SiteHeader } from '../../../components/layout/site-header';
import { MobileNav } from '../../../components/layout/mobile-nav';
import { Container } from '../../../components/layout/container';
import { ToastProvider } from '../../../components/ui/toast';
import { Badge } from '../../../components/ui/badge';
import { Spinner } from '../../../components/ui/spinner';
import type { CurrentUser } from '@app/contracts';
import { cn } from '../../../lib/cn';
import { useMyBusinesses } from '../../../lib/api/businesses';
import { dashboardNavGroups, parseDashboardBusinessId } from '../../../lib/dashboard-nav';

/**
 * `(dashboard)` route-group shell (F7.1). Header + (when a business is
 * selected) a business selector dropdown and a grouped, section-scoped
 * sidebar; mobile gets a horizontal scroller of the same sections. The
 * shell owns the TanStack cache for the owner's businesses so the selector
 * and the `/dashboard` overview share one fetch.
 *
 * Authorization stays server-side: the `(dashboard)` layout runs the
 * owner|admin guard before this shell mounts, and every dashboard endpoint
 * re-checks ownership on the API. The selector lists only businesses the
 * API returned for `/businesses/me` — never a guessed id.
 */
export function DashboardShell({
  children,
  initialUser,
  initialApiError,
}: {
  children: ReactNode;
  initialUser: CurrentUser | null;
  initialApiError: boolean;
}) {
  const t = useTranslations('dashboard');
  const pathname = usePathname();
  const router = useRouter();
  const { businesses, isPending } = useMyBusinesses();

  const businessId = parseDashboardBusinessId(pathname);
  const onBusinessPage = businessId !== null;
  const groups = businessId ? dashboardNavGroups(businessId) : [];

  const renderItem = (item: (typeof groups)[number]['items'][number]) => {
    const active = item.href === pathname || pathname.startsWith(`${item.href}/`);
    const label = t(`nav.${item.labelKey}`);
    if (!item.available) {
      return (
        <span
          key={item.key}
          aria-disabled="true"
          title={t('nav.soon')}
          className="flex cursor-not-allowed items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted"
        >
          {label}
          <Badge variant="neutral" className="shrink-0">
            {t('nav.soon')}
          </Badge>
        </span>
      );
    }
    return (
      <Link
        key={item.key}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block rounded-md px-3 py-2 text-sm',
          active
            ? 'bg-surface-alt text-text'
            : 'text-text-subtle hover:bg-surface-alt hover:text-text',
        )}
      >
        {label}
      </Link>
    );
  };

  const flatItems = groups.flatMap((group) => group.items);

  return (
    <AuthProvider initialUser={initialUser} initialApiError={initialApiError}>
      <ToastProvider>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main id="main" className="flex-1 pb-16 md:pb-0">
            <Container className="py-6">
              {/* Business selector — only on a per-business page. */}
              {onBusinessPage && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <label htmlFor="dashboard-business-select" className="text-sm text-text-subtle">
                    {t('selector.label')}
                  </label>
                  {isPending ? (
                    <Spinner size="sm" aria-label={t('selector.loading')} />
                  ) : businesses.length === 0 ? (
                    <span className="text-sm text-muted">{t('selector.empty')}</span>
                  ) : (
                    <select
                      id="dashboard-business-select"
                      value={businessId ?? ''}
                      onChange={(e) => router.push(`/dashboard/${e.target.value}`)}
                      className="max-w-xs truncate rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
                    >
                      {businesses.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Mobile: horizontal section scroller (per-business only). */}
              {onBusinessPage && (
                <nav aria-label={t('title')} className="mb-4 flex gap-1 overflow-x-auto md:hidden">
                  {flatItems.map((item) => {
                    const active = item.href === pathname;
                    if (!item.available) {
                      return (
                        <span
                          key={item.key}
                          aria-disabled="true"
                          className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted"
                        >
                          {t(`nav.${item.labelKey}`)}
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'whitespace-nowrap rounded-md px-3 py-2 text-sm',
                          active ? 'bg-surface-alt text-text' : 'text-text-subtle',
                        )}
                      >
                        {t(`nav.${item.labelKey}`)}
                      </Link>
                    );
                  })}
                </nav>
              )}

              <div className="flex gap-6">
                {/* Desktop: grouped vertical sidebar (per-business only). */}
                {onBusinessPage && (
                  <aside className="sticky top-6 hidden h-fit w-60 shrink-0 space-y-5 md:block">
                    <div>
                      <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted">
                        {t('title')}
                      </p>
                    </div>
                    {groups.map((group) => (
                      <nav
                        key={group.key}
                        aria-label={t(`group.${group.key}`)}
                        className="space-y-1"
                      >
                        <p className="px-3 text-xs font-medium text-muted">
                          {t(`group.${group.key}`)}
                        </p>
                        {group.items.map(renderItem)}
                      </nav>
                    ))}
                  </aside>
                )}
                <div className="min-w-0 flex-1">{children}</div>
              </div>
            </Container>
          </main>
          <MobileNav />
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
