import type { LucideIcon } from 'lucide-react';
import { Home, Search, LayoutDashboard, Building2, CalendarDays, User, Shield } from 'lucide-react';
import type { UserRole } from '@app/contracts';

/**
 * Navigation config (F1.7). The header primary nav and the mobile tab bar
 * both read from this array so a later prompt only adds an entry here.
 *
 * `visibleFor` restricts an item to a role set; `undefined` means public.
 */

export interface NavItem {
  key: string;
  href: string;
  /** i18n key under `nav.*`. */
  labelKey: string;
  icon: LucideIcon;
  /** When set, the item renders only for these roles (and authenticated). */
  visibleFor?: ReadonlyArray<UserRole>;
  /** Show in the mobile bottom tab bar (max ~4 items + account). */
  mobile?: boolean;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: 'home', href: '/', labelKey: 'nav.home', icon: Home, mobile: true },
  { key: 'search', href: '/search', labelKey: 'nav.search', icon: Search, mobile: true },
  {
    key: 'dashboard',
    href: '/dashboard',
    labelKey: 'nav.dashboard',
    icon: LayoutDashboard,
    visibleFor: ['owner', 'admin', 'super_admin'],
    mobile: true,
  },
  {
    key: 'businesses',
    href: '/businesses',
    labelKey: 'nav.businesses',
    icon: Building2,
  },
  {
    key: 'bookings',
    href: '/bookings',
    labelKey: 'nav.bookings',
    icon: CalendarDays,
    visibleFor: ['user', 'owner', 'admin', 'super_admin'],
  },
  {
    key: 'admin',
    href: '/admin',
    labelKey: 'nav.admin',
    icon: Shield,
    visibleFor: ['moderator', 'admin', 'super_admin'],
  },
];

/** Account tab (always present on mobile, role-aware). */
export const ACCOUNT_NAV_ITEM: NavItem = {
  key: 'account',
  href: '/account',
  labelKey: 'nav.account',
  icon: User,
  mobile: true,
};

/** Footer link columns. */
export interface FooterColumn {
  key: string;
  /** i18n key under `footer.*` for the column heading. */
  titleKey: string;
  links: ReadonlyArray<{ key: string; href: string; labelKey: string }>;
}

export const FOOTER_COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    key: 'explore',
    titleKey: 'footer.explore',
    links: [
      { key: 'home', href: '/', labelKey: 'nav.home' },
      { key: 'search', href: '/search', labelKey: 'nav.search' },
      { key: 'businesses', href: '/businesses', labelKey: 'nav.businesses' },
    ],
  },
  {
    key: 'account',
    titleKey: 'footer.account',
    links: [
      { key: 'login', href: '/login', labelKey: 'nav.login' },
      { key: 'register', href: '/register', labelKey: 'nav.register' },
      { key: 'account', href: '/account', labelKey: 'nav.account' },
    ],
  },
  {
    key: 'legal',
    titleKey: 'footer.legal',
    links: [
      { key: 'terms', href: '/p/terms', labelKey: 'footer.terms' },
      { key: 'privacy', href: '/p/privacy', labelKey: 'footer.privacy' },
    ],
  },
];

/** Header style attribute values (DESIGN.md section 10). */
export type HeaderStyle = 'translucent' | 'solid' | 'transparent';

/** Pages with a hero opt into the transparent header via this marker. */
export const HERO_HEADER_ATTR = 'transparent';
export const DEFAULT_HEADER_ATTR: HeaderStyle = 'solid';
