/**
 * Owner dashboard navigation (F7.1). Pure, framework-free data + helper so
 * the business→section filtering is unit-testable without Next.js, mirroring
 * `admin-nav.ts`.
 *
 * Every section is business-scoped: `/dashboard/:businessId/<section>`. The
 * `(dashboard)` route-group guard already rejects non-owner roles, so this
 * helper does not re-mirror `ROLE_PERMISSIONS`; it only carries `available`
 * so the shell renders unbuilt sections as disabled "soon" placeholders
 * (exactly the admin-shell grammar). The prompt that implements a section
 * flips `available` to `true` here.
 */

/** A section of the owner dashboard for one business. */
export interface DashboardNavItem {
  key: string;
  /** Section href relative to the locale root, e.g. `/dashboard/:id/profile`. */
  href: string;
  /** i18n key under `dashboard.nav.*`. */
  labelKey: string;
  /**
   * Set to `true` by the prompt that implements the page. Unimplemented
   * sections render disabled ("soon") in the sidebar instead of dead links.
   */
  available: boolean;
}

export interface DashboardNavGroup {
  /** i18n key under `dashboard.group.*`. */
  key: string;
  items: ReadonlyArray<DashboardNavItem>;
}

/**
 * The dashboard sections for one business. `businessId` is interpolated into
 * every href; the caller passes the URL-resolved id (the `(dashboard)`
 * guard + the API ownership check stay the source of truth for access).
 */
export function dashboardNavGroups(businessId: string): ReadonlyArray<DashboardNavGroup> {
  const base = `/dashboard/${businessId}`;
  return [
    {
      key: 'overview',
      items: [
        { key: 'overview', href: base, labelKey: 'overview', available: true }, // F7.1
      ],
    },
    {
      key: 'manage',
      items: [
        { key: 'profile', href: `${base}/profile`, labelKey: 'profile', available: false }, // F7.2
        { key: 'gallery', href: `${base}/gallery`, labelKey: 'gallery', available: false }, // F7.3
        { key: 'menu', href: `${base}/menu`, labelKey: 'menu', available: false }, // F7.3
        { key: 'reviews', href: `${base}/reviews`, labelKey: 'reviews', available: false }, // F7.4
        { key: 'qa', href: `${base}/qa`, labelKey: 'qa', available: false }, // F7.4
      ],
    },
    {
      key: 'engagement',
      items: [
        { key: 'bookings', href: `${base}/bookings`, labelKey: 'bookings', available: false }, // F7.5
        { key: 'messages', href: `${base}/messages`, labelKey: 'messages', available: false }, // F7.6
        { key: 'analytics', href: `${base}/analytics`, labelKey: 'analytics', available: false }, // F7.8
      ],
    },
  ];
}

/** The linkable (built) sections for one business — used by the overview's
 *  shortcut cards so they never link to an unbuilt page. */
export function availableDashboardItems(businessId: string): ReadonlyArray<DashboardNavItem> {
  return dashboardNavGroups(businessId)
    .flatMap((group) => group.items)
    .filter((item) => item.available);
}

/**
 * Parse a `/dashboard/:businessId[/...rest]` pathname into the businessId
 * (or `null` when the path is `/dashboard` with no segment). Used by the
 * shell to decide whether to render the business selector + section sidebar.
 * The locale prefix (`/fa`/`/en`) is handled by `@/i18n/navigation`'s
 * `usePathname`, which returns the locale-stripped path.
 */
export function parseDashboardBusinessId(pathname: string): string | null {
  // Match `/dashboard/:id` where id is a UUID, optionally followed by more.
  const match = pathname.match(/^\/dashboard\/([0-9a-fA-F-]{36})(?:\/|$)/);
  return match?.[1] ?? null;
}
