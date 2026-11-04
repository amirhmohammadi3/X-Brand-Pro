'use client';

import { useTranslations } from 'next-intl';
import { LogOut, Settings, Shield, User as UserIcon, LayoutDashboard } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from '../ui/dropdown-menu';
import type { UserRole } from '@app/contracts';
import type { LucideIcon } from 'lucide-react';

const ADMIN_ROLES: ReadonlyArray<UserRole> = ['moderator', 'admin', 'super_admin'];
const DASHBOARD_ROLES: ReadonlyArray<UserRole> = ['owner', 'admin', 'super_admin'];

function hasRole(userRole: UserRole | undefined, allowed: ReadonlyArray<UserRole>): boolean {
  return !!userRole && allowed.includes(userRole);
}

interface MenuItem {
  key: string;
  href: string;
  icon: LucideIcon;
  destructive?: boolean;
}

/**
 * `UserMenu` (F1.7).
 * - Anonymous: «Log in» and «Register» buttons inline.
 * - Authenticated: avatar menu with Profile / Sessions, a Dashboard link for
 *   owners/admins, an Admin panel link for moderators/admins/super_admin, and
 *   Logout. Role-gated links render only when the role qualifies.
 *
 * Navigation uses the next-intl router (which preserves the locale segment)
 * inside `onSelect`, so Radix closes the menu on click and we route cleanly.
 */
export function UserMenu() {
  const t = useTranslations('auth.menu');
  const router = useRouter();
  const { user, status, logout } = useAuth();

  if (status === 'loading') {
    return (
      <span
        className="inline-block h-9 w-9 animate-pulse rounded-full bg-surface-alt"
        aria-hidden="true"
      />
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/login')}>
          {t('login')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => router.push('/register')}>
          {t('register')}
        </Button>
      </div>
    );
  }

  const displayName = user.displayName ?? user.username;
  const showDashboard = hasRole(user.role, DASHBOARD_ROLES);
  const showAdmin = hasRole(user.role, ADMIN_ROLES);

  const items: MenuItem[] = [
    { key: 'profile', href: '/account/profile', icon: UserIcon },
    { key: 'sessions', href: '/account/sessions', icon: Settings },
  ];
  if (showDashboard) items.push({ key: 'dashboard', href: '/dashboard', icon: LayoutDashboard });
  if (showAdmin) items.push({ key: 'admin', href: '/admin', icon: Shield });

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className="inline-flex items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={t('account')}
        >
          <Avatar src={user.avatarUrl ?? undefined} name={displayName} size="sm" />
        </button>
      }
    >
      <DropdownLabel>{displayName}</DropdownLabel>
      <DropdownSeparator />
      {items.map(({ key, href, icon: Icon }) => (
        <DropdownItem key={key} onSelect={() => router.push(href)}>
          <Icon size={16} />
          {t(key)}
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <DropdownItem onSelect={() => void logout()} destructive>
        <LogOut size={16} />
        {t('logout')}
      </DropdownItem>
    </DropdownMenu>
  );
}
