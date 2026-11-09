/**
 * Admin navigation config tests (F2.1). Pure unit tests for the role →
 * section filtering and the structural invariants (unique keys, /admin
 * prefixes, label keys) — the API re-checks the real permission on every
 * endpoint, so these only guard the UI mirror.
 */
import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_GROUPS,
  adminSectionsForRole,
  availableAdminItems,
  type AdminNavItem,
} from '../../src/lib/admin-nav';

function flattenItems(groups: ReturnType<typeof adminSectionsForRole>): AdminNavItem[] {
  return groups.flatMap((g) => [...g.items]);
}

describe('ADMIN_NAV_GROUPS structure', () => {
  it('keys are unique and hrefs point under /admin', () => {
    const items = flattenItems(ADMIN_NAV_GROUPS.map((g) => ({ key: g.key, items: g.items })));
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of items) {
      expect(item.href).toMatch(/^\/admin(\/|$)/);
      expect(item.labelKey).toMatch(/^[a-z]+$/);
    }
  });

  it('the dashboard entry is available from the start', () => {
    const dashboard = flattenItems(ADMIN_NAV_GROUPS).find((i) => i.key === 'dashboard');
    expect(dashboard?.available).toBe(true);
    expect(dashboard?.permissions).toHaveLength(0);
  });
});

describe('adminSectionsForRole', () => {
  it('regular users and owners see nothing (route guard denies them anyway)', () => {
    expect(adminSectionsForRole('user')).toEqual([]);
    expect(adminSectionsForRole('owner')).toEqual([]);
  });

  it('moderator sees the dashboard and the users section only', () => {
    const items = flattenItems(adminSectionsForRole('moderator')).map((i) => i.key);
    expect(items).toEqual(['dashboard', 'users']);
  });

  it('moderator does NOT see catalog.manage sections (ALL-of semantics)', () => {
    // moderator holds `users.read` but not `catalog.manage` — an item
    // requiring BOTH must stay hidden even though one permission matches.
    const keys = flattenItems(adminSectionsForRole('moderator')).map((i) => i.key);
    expect(keys).not.toContain('cities');
    expect(keys).not.toContain('audit');
  });

  it('admin sees every section', () => {
    const items = flattenItems(adminSectionsForRole('admin')).map((i) => i.key);
    expect(items).toEqual([
      'dashboard',
      'cities',
      'categories',
      'amenities',
      'languages',
      'theme',
      'users',
      'settings',
      'audit',
    ]);
  });

  it('super_admin sees every section (wildcard permission)', () => {
    const admin = flattenItems(adminSectionsForRole('admin')).map((i) => i.key);
    const superAdmin = flattenItems(adminSectionsForRole('super_admin')).map((i) => i.key);
    expect(superAdmin).toEqual(admin);
  });

  it('preserves group order and drops empty groups', () => {
    const moderatorGroups = adminSectionsForRole('moderator').map((g) => g.key);
    expect(moderatorGroups).toEqual(['overview', 'access']);
  });
});

describe('availableAdminItems', () => {
  it('returns only linkable (implemented) sections', () => {
    const admin = availableAdminItems('admin');
    // F2.1: only the dashboard page exists; later prompts flip their flags.
    expect(admin.some((i) => i.key === 'dashboard')).toBe(true);
    for (const item of admin) expect(item.available).toBe(true);
  });

  it('never returns unavailable items even for super_admin', () => {
    for (const item of availableAdminItems('super_admin')) {
      expect(item.available).toBe(true);
    }
  });
});
