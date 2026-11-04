'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { NAV_ITEMS, ACCOUNT_NAV_ITEM } from '../../lib/nav.config';
import { useAuth } from '../../lib/auth/auth-context';
import { cn } from '../../lib/cn';
import type { UserRole } from '@app/contracts';

function itemVisible(
  role: UserRole | undefined,
  visibleFor: ReadonlyArray<UserRole> | undefined,
  authenticated: boolean,
): boolean {
  if (!visibleFor) return true;
  if (!authenticated || !role) return false;
  return visibleFor.includes(role);
}

/**
 * `MobileNav` (F1.7). A bottom tab bar for xs/sm screens. Renders the mobile
 * nav items (max ~4) plus an account tab. Hides on scroll-down and shows on
 * scroll-up, respecting `prefers-reduced-motion` (a reduced-motion user gets
 * no transform animation and the bar stays put). Safe-area padding keeps it
 * clear of the home indicator on iOS.
 */
export function MobileNav() {
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const { user, status } = useAuth();
  const authenticated = status === 'authenticated';

  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return; // keep the bar always visible.

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        // Only react to scrolls past a small threshold to avoid jitter.
        if (y < 8) {
          setHidden(false);
        } else if (delta > 8) {
          setHidden(true);
        } else if (delta < -8) {
          setHidden(false);
        }
        lastY.current = y;
        ticking.current = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const items = [
    ...NAV_ITEMS.filter((i) => i.mobile && itemVisible(user?.role, i.visibleFor, authenticated)),
    ACCOUNT_NAV_ITEM,
  ].slice(0, 5);

  return (
    <nav
      aria-label={tNav('menu')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border-subtle bg-surface',
        'pb-[env(safe-area-inset-bottom)] md:hidden',
        'transition-transform duration-200',
        hidden ? 'translate-y-full' : 'translate-y-0',
      )}
    >
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem]',
              active ? 'text-primary' : 'text-text-subtle',
            )}
          >
            <Icon size={20} />
            <span>{tNav(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
