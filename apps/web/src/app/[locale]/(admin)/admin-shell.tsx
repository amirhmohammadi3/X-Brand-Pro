'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { AuthProvider } from '../../../lib/auth/auth-context';
import { adminSectionsForRole } from '../../../lib/admin-nav';
import { SiteHeader } from '../../../components/layout/site-header';
import { MobileNav } from '../../../components/layout/mobile-nav';
import { Container } from '../../../components/layout/container';
import { ToastProvider } from '../../../components/ui/toast';
import { Badge } from '../../../components/ui/badge';
import type { CurrentUser } from '@app/contracts';
import { cn } from '../../../lib/cn';

/**
 * Admin panel shell (F2.1). SiteHeader + a desktop sidebar whose groups and
 * items come from `adminSectionsForRole` (permission-mirrored) and a
 * horizontal scroller on mobile — the same layout grammar as the account
 * area. Sections whose page is not implemented yet render disabled with a
 * "soon" badge instead of a dead link.
 *
 * Authorization stays server-side: the `(admin)` layout runs the guard
 * before this shell mounts, and every admin endpoint re-checks the real
 * permission on the API.
 */
export function AdminShell({
  children,
  initialUser,
  initialApiError,
}: {
  children: ReactNode;
  initialUser: CurrentUser | null;
  initialApiError: boolean;
}) {
  const t = useTranslations('admin');
  const pathname = usePathname();

  const groups = adminSectionsForRole(initialUser?.role ?? 'user');

  const renderItem = (item: (typeof groups)[number]['items'][number]) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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

  // Mobile scroller: a flat, ordered list of the same items (with group
  // labels as separators) so every section is one tap away.
  const flatItems = groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, groupKey: group.key })),
  );

  return (
    <AuthProvider initialUser={initialUser} initialApiError={initialApiError}>
      <ToastProvider>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main id="main" className="flex-1 pb-16 md:pb-0">
            <Container className="py-6">
              {/* Mobile: horizontal tab scroller. */}
              <nav aria-label={t('title')} className="mb-4 flex gap-1 overflow-x-auto md:hidden">
                {flatItems.map((item) => {
                  const active = pathname === item.href;
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

              <div className="flex gap-6">
                {/* Desktop: grouped vertical sidebar. */}
                <aside className="sticky top-6 hidden h-fit w-60 shrink-0 space-y-5 md:block">
                  <div>
                    <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted">
                      {t('title')}
                    </p>
                  </div>
                  {groups.map((group) => (
                    <nav key={group.key} aria-label={t(`group.${group.key}`)} className="space-y-1">
                      <p className="px-3 text-xs font-medium text-muted">
                        {t(`group.${group.key}`)}
                      </p>
                      {group.items.map(renderItem)}
                    </nav>
                  ))}
                </aside>
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
