import { describe, expect, it } from 'vitest';
import { decideAccess } from '../../src/lib/auth/guard';
import type { CurrentUser } from '@app/contracts';

function makeUser(role: CurrentUser['role']): CurrentUser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'tester',
    email: 't@e.com',
    phone: null,
    role,
    status: 'active',
    displayName: 'Tester',
    bio: null,
    locale: 'en',
    avatarUrl: null,
    hasPassword: true,
    emailVerified: true,
    phoneVerified: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('decideAccess (F1.7 guard)', () => {
  it('no user → login decision with next path', () => {
    const d = decideAccess({ user: null, pathname: '/account' });
    expect(d.kind).toBe('login');
    if (d.kind === 'login') expect(d.next).toBe('/account');
  });

  it('user present, no roles required → allow', () => {
    const d = decideAccess({ user: makeUser('user'), pathname: '/account' });
    expect(d.kind).toBe('allow');
  });

  it('user with required role → allow', () => {
    const d = decideAccess({
      user: makeUser('owner'),
      roles: ['owner', 'admin'],
      pathname: '/dashboard',
    });
    expect(d.kind).toBe('allow');
  });

  it('user without required role → forbidden', () => {
    const d = decideAccess({
      user: makeUser('user'),
      roles: ['owner', 'admin'],
      pathname: '/dashboard',
    });
    expect(d.kind).toBe('forbidden');
  });

  it('admin role passes admin guard', () => {
    const d = decideAccess({
      user: makeUser('admin'),
      roles: ['moderator', 'admin', 'super_admin'],
      pathname: '/admin',
    });
    expect(d.kind).toBe('allow');
  });

  it('moderator passes admin guard but fails dashboard guard', () => {
    expect(
      decideAccess({
        user: makeUser('moderator'),
        roles: ['owner', 'admin'],
        pathname: '/dashboard',
      }).kind,
    ).toBe('forbidden');
    expect(
      decideAccess({
        user: makeUser('moderator'),
        roles: ['moderator', 'admin', 'super_admin'],
        pathname: '/admin',
      }).kind,
    ).toBe('allow');
  });
});
