'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { BRAND } from '../../lib/brand';
import { NAV_ITEMS } from '../../lib/nav.config';
import { useAuth } from '../../lib/auth/auth-context';
import { Container } from './container';
import { LanguageSwitcher } from './language-switcher';
import { ThemeModeToggle } from './theme-mode-toggle';
import { UserMenu } from './user-menu';
import { NotificationBell } from './notification-bell';
import { cn } from '../../lib/cn';
import type { UserRole } from '@app/contracts';

function itemVisible(
  role: UserRole | undefined,
  authenticated: boolean,
  visibleFor?: ReadonlyArray<UserRole>,
): boolean {
  if (!visibleFor) return true;
  if (!authenticated || !role) return false;
  return visibleFor.includes(role);
}

/**
 * `SiteHeader` (F1.7). Brand mark + name linking to `/`, the primary nav
 * (items from `NAV_ITEMS`, role-filtered), search entry link, language
 * switcher, theme mode toggle and the user menu. Sticky. The header style
 * follows the `data-header` attribute on `<html>` (translucent / solid /
 * transparent-on-hero) via the `data-[header=…]` variant classes.
 */
export function SiteHeader() {
  const tNav = useTranslations('nav');
  const tBrand = useTranslations('brand');
  const pathname = usePathname();
  const { user, status } = useAuth();
  const authenticated = status === 'authenticated';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-border-subtle',
        'data-[header=translucent]:bg-surface/80 data-[header=translucent]:backdrop-blur',
        'data-[header=solid]:bg-surface',
        'data-[header=transparent]:bg-transparent data-[header=transparent]:border-transparent',
      )}
    >
      <Container className="flex h-14 items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={tBrand('name')}
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-on-primary">
            {BRAND.mark}
          </span>
          <span className="text-base font-semibold text-text">{tBrand('name')}</span>
        </Link>

        <nav aria-label={tNav('menu')} className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            if (!itemVisible(user?.role, authenticated, item.visibleFor)) return null;
            const active = pathname === item.href;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium',
                  active
                    ? 'bg-surface-alt text-text'
                    : 'text-text-subtle hover:bg-surface-alt hover:text-text',
                )}
              >
                {tNav(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeModeToggle />
          {authenticated ? <NotificationBell /> : null}
          <div className="ms-1">
            <UserMenu />
          </div>
        </div>
      </Container>
    </header>
  );
}
