/**
 * Dashboard navigation config tests (F7.1). Pure unit tests for the
 * business → section mapping and the pathname parser — the (dashboard)
 * route-group guard + the API ownership check stay the source of truth for
 * access; these only guard the UI config.
 */
import { describe, expect, it } from 'vitest';
import {
  availableDashboardItems,
  dashboardNavGroups,
  parseDashboardBusinessId,
  type DashboardNavItem,
} from '../../src/lib/dashboard-nav';

const BIZ_ID = '11111111-2222-3333-4444-555555555555';

function flattenItems(groups: ReturnType<typeof dashboardNavGroups>): DashboardNavItem[] {
  return groups.flatMap((g) => [...g.items]);
}

describe('dashboardNavGroups structure', () => {
  it('keys are unique and hrefs are scoped under /dashboard/:id', () => {
    const items = flattenItems(dashboardNavGroups(BIZ_ID));
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of items) {
      expect(item.href).toMatch(new RegExp(`^/dashboard/${BIZ_ID}(/|$)`));
      expect(item.labelKey).toMatch(/^[a-z]+$/);
    }
  });

  it('the overview entry is the bare /dashboard/:id and is available from F7.1', () => {
    const overview = flattenItems(dashboardNavGroups(BIZ_ID)).find((i) => i.key === 'overview');
    expect(overview?.href).toBe(`/dashboard/${BIZ_ID}`);
    expect(overview?.available).toBe(true);
  });

  it('the overview + profile are built (F7.1 + F7.2); every other section is "soon"', () => {
    const items = flattenItems(dashboardNavGroups(BIZ_ID));
    const available = items.filter((i) => i.available).map((i) => i.key);
    expect(available).toEqual(['overview', 'profile']);
    const soon = items.filter((i) => !i.available).map((i) => i.key);
    // The F7.3–F7.8 sections, all disabled until their prompt lands.
    expect(soon).toEqual(
      expect.arrayContaining([
        'gallery',
        'menu',
        'reviews',
        'qa',
        'bookings',
        'messages',
        'analytics',
      ]),
    );
  });

  it('different business ids interpolate into the hrefs', () => {
    const other = '99999999-8888-7777-6666-555555555555';
    const overview = flattenItems(dashboardNavGroups(other)).find((i) => i.key === 'overview');
    expect(overview?.href).toBe(`/dashboard/${other}`);
  });
});

describe('availableDashboardItems', () => {
  it('returns only linkable items (overview + profile in F7.1/F7.2)', () => {
    const items = availableDashboardItems(BIZ_ID);
    expect(items.map((i) => i.key)).toEqual(['overview', 'profile']);
  });
});

describe('parseDashboardBusinessId', () => {
  it('extracts the id from /dashboard/:id', () => {
    expect(parseDashboardBusinessId(`/dashboard/${BIZ_ID}`)).toBe(BIZ_ID);
  });

  it('extracts the id from a deeper section path', () => {
    expect(parseDashboardBusinessId(`/dashboard/${BIZ_ID}/profile`)).toBe(BIZ_ID);
  });

  it('returns null for the bare /dashboard overview', () => {
    expect(parseDashboardBusinessId('/dashboard')).toBeNull();
  });

  it('returns null for unrelated paths', () => {
    expect(parseDashboardBusinessId('/account/profile')).toBeNull();
    expect(parseDashboardBusinessId('/admin/users')).toBeNull();
  });

  it('rejects a non-UUID segment', () => {
    expect(parseDashboardBusinessId('/dashboard/not-a-uuid')).toBeNull();
  });
});
