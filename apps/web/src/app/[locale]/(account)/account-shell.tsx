'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { AuthProvider } from '../../../lib/auth/auth-context';
import { SiteHeader } from '../../../components/layout/site-header';
import { MobileNav } from '../../../components/layout/mobile-nav';
import { Container } from '../../../components/layout/container';
import type { CurrentUser } from '@app/contracts';
import { cn } from '../../../lib/cn';

const SIDEBAR_ITEMS = [
  { key: 'profile', href: '/account/profile' },
  { key: 'sessions', href: '/account/sessions' },
] as const;

/**
 * `(account)` route group shell (F1.7). Header + a desktop sidebar
 * (Profile, Sessions, …) and a horizontal tab scroller on mobile. Requires
 * login — the server layout redirects anonymous users to `/login?next=`.
 */
export function AccountShell({
  children,
  initialUser,
  initialApiError,
}: {
  children: ReactNode;
  initialUser: CurrentUser | null;
  initialApiError: boolean;
}) {
  const t = useTranslations('auth.menu');
  const pathname = usePathname();

  return (
    <AuthProvider initialUser={initialUser} initialApiError={initialApiError}>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main id="main" className="flex-1 pb-16 md:pb-0">
          <Container className="py-6">
            {/* Mobile: horizontal tab scroller. */}
            <nav aria-label={t('account')} className="mb-4 flex gap-1 overflow-x-auto md:hidden">
              {SIDEBAR_ITEMS.map((item) => {
                const active = pathname === item.href;
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
                    {t(item.key)}
                  </Link>
                );
              })}
            </nav>

            <div className="flex gap-6">
              {/* Desktop: vertical sidebar. */}
              <aside className="hidden w-56 shrink-0 md:block">
                <nav aria-label={t('account')} className="space-y-1">
                  {SIDEBAR_ITEMS.map((item) => {
                    const active = pathname === item.href;
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
                        {t(item.key)}
                      </Link>
                    );
                  })}
                </nav>
              </aside>
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </Container>
        </main>
        <MobileNav />
      </div>
    </AuthProvider>
  );
}
