'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { AuthProvider } from '../../../lib/auth/auth-context';
import { SiteHeader } from '../../../components/layout/site-header';
import { MobileNav } from '../../../components/layout/mobile-nav';
import { Container } from '../../../components/layout/container';
import { ToastProvider } from '../../../components/ui/toast';
import type { CurrentUser } from '@app/contracts';
import { cn } from '../../../lib/cn';

// F1.9: the account sidebar exposes the profile and settings tabs. Later
// prompts append reviews, bookmarks, messages, notifications and
// reservations. F5.1 appends the favorites tab; F5.2 appends following + feed.
const SIDEBAR_ITEMS = [
  { key: 'profile', href: '/account/profile' },
  { key: 'favorites', href: '/account/favorites' },
  { key: 'following', href: '/account/following' },
  { key: 'feed', href: '/account/feed' },
  { key: 'settings', href: '/account/settings' },
] as const;

/**
 * `(account)` route group shell (F1.7). Header + a desktop sidebar
 * (Profile, …) and a horizontal tab scroller on mobile. Requires login — the
 * server layout redirects anonymous users to `/login?next=`. ToastProvider is
 * mounted here so account forms (F1.9) can surface success/failure feedback.
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
      <ToastProvider>
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
      </ToastProvider>
    </AuthProvider>
  );
}
