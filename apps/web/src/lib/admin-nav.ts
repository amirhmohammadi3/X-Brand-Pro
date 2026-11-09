import type { UserRole } from '@app/contracts';

/**
 * Admin panel navigation (F2.1). Pure, framework-free data + helper so the
 * role→section filtering is unit-testable without Next.js.
 *
 * The sidebar (admin-shell) and the `/admin` overview page both read from
 * `ADMIN_NAV_GROUPS`; a later prompt only adds an entry here (the same
 * pattern as `nav.config.ts`).
 *
 * Permissions MIRROR the API's `ROLE_PERMISSIONS` map
 * (apps/api/src/modules/users/users.service.ts, B1.5): the API stays the
 * single source of truth for authorization — a user without the permission
 * still gets 403 from every admin endpoint even if the UI showed the link.
 * The mirror exists only so the sidebar hides sections a role can never use
 * (moderator sees Users, not Cities/Theme/Settings).
 */

/** A section of the admin panel. */
export interface AdminNavItem {
  key: string;
  href: string;
  /** i18n key under `admin.nav.*`. */
  labelKey: string;
  /** Every listed permission must be held (ALL-of, like the API guard). */
  permissions: ReadonlyArray<string>;
  /**
   * Set to `true` by the prompt that implements the page. Unimplemented
   * sections render disabled ("soon") in the sidebar instead of dead links.
   */
  available: boolean;
}

export interface AdminNavGroup {
  /** i18n key under `admin.group.*`. */
  key: string;
  items: ReadonlyArray<AdminNavItem>;
}

export const ADMIN_NAV_GROUPS: ReadonlyArray<AdminNavGroup> = [
  {
    key: 'overview',
    items: [
      { key: 'dashboard', href: '/admin', labelKey: 'dashboard', permissions: [], available: true },
    ],
  },
  {
    key: 'catalog',
    items: [
      {
        key: 'cities',
        href: '/admin/cities',
        labelKey: 'cities',
        permissions: ['catalog.manage'],
        available: true, // F2.2
      },
      {
        key: 'categories',
        href: '/admin/categories',
        labelKey: 'categories',
        permissions: ['catalog.manage'],
        available: true, // F2.2
      },
      {
        key: 'amenities',
        href: '/admin/amenities',
        labelKey: 'amenities',
        permissions: ['catalog.manage'],
        available: true, // F2.2
      },
    ],
  },
  {
    key: 'localization',
    items: [
      {
        key: 'languages',
        href: '/admin/languages',
        labelKey: 'languages',
        permissions: ['i18n.manage'],
        available: true, // F2.3
      },
    ],
  },
  {
    key: 'appearance',
    items: [
      {
        key: 'theme',
        href: '/admin/theme',
        labelKey: 'theme',
        permissions: ['theme.manage'],
        available: true, // F2.4
      },
    ],
  },
  {
    key: 'access',
    items: [
      {
        key: 'users',
        href: '/admin/users',
        labelKey: 'users',
        permissions: ['users.read'],
        available: true, // F2.5
      },
    ],
  },
  {
    key: 'platform',
    items: [
      {
        key: 'settings',
        href: '/admin/settings',
        labelKey: 'settings',
        permissions: ['settings.manage'],
        available: true, // F2.4
      },
      {
        key: 'audit',
        href: '/admin/audit',
        labelKey: 'audit',
        permissions: ['audit.read'],
        available: false, // F10.5
      },
    ],
  },
];

/**
 * UI mirror of the API's `ROLE_PERMISSIONS` (moderator/admin/super_admin
 * only — the `(admin)` route group guard already rejects other roles, but
 * the helper is total so tests can assert `user`/`owner` see nothing).
 */
const ADMIN_ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly string[]>> = {
  user: [],
  owner: [],
  moderator: ['users.read'],
  admin: [
    'settings.manage',
    'audit.read',
    'i18n.manage',
    'theme.manage',
    'catalog.manage',
    'businesses.manage',
    'users.read',
    'users.manage',
  ],
  super_admin: ['*'],
};

function roleHolds(role: UserRole, required: ReadonlyArray<string>): boolean {
  // Non-admin roles never reach this UI (the route guard redirects them);
  // even items with no permission requirement are admin-area sections.
  if (role !== 'moderator' && role !== 'admin' && role !== 'super_admin') return false;
  const held = ADMIN_ROLE_PERMISSIONS[role] ?? [];
  if (held.includes('*')) return true;
  return required.every((permission) => held.includes(permission));
}

/**
 * The groups + items the given role may see, keeping the original group
 * order and dropping empty groups. Items are returned regardless of
 * `available` so the shell can render the "soon" placeholders; use
 * {@link availableAdminItems} for linkable entries only (overview cards).
 */
export function adminSectionsForRole(role: UserRole): ReadonlyArray<AdminNavGroup> {
  return ADMIN_NAV_GROUPS.map((group) => ({
    key: group.key,
    items: group.items.filter((item) => roleHolds(role, item.permissions)),
  })).filter((group) => group.items.length > 0);
}

/** The role's sections that are built and linkable at present. */
export function availableAdminItems(role: UserRole): ReadonlyArray<AdminNavItem> {
  return adminSectionsForRole(role)
    .flatMap((group) => group.items)
    .filter((item) => item.available);
}
