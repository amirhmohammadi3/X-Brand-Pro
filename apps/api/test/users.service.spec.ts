import { describe, expect, it, vi } from 'vitest';
import { type EventEmitter2 } from '@nestjs/event-emitter';
import {
  UsersService,
  USER_ROLE_CHANGED,
  USER_STATUS_CHANGED,
} from '../src/modules/users/users.service.js';
import type { UsersRepositoryLike } from '../src/modules/users/users.repository.js';
import type { UserRow } from '../src/db/schema/users.js';
import type { MediaRowLite } from './auth.utils.js';
import { makeMemoryUserRepo } from './auth.utils.js';

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: overrides.id ?? 'u-1',
    username: overrides.username ?? 'amir',
    email: overrides.email ?? null,
    phone: overrides.phone ?? null,
    passwordHash: overrides.passwordHash ?? null,
    role: overrides.role ?? 'user',
    status: overrides.status ?? 'active',
    displayName: overrides.displayName ?? null,
    locale: overrides.locale ?? null,
    avatarMediaId: overrides.avatarMediaId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt ?? null,
    phoneVerifiedAt: overrides.phoneVerifiedAt ?? null,
    bannedUntil: overrides.bannedUntil ?? null,
    bannedReason: overrides.bannedReason ?? null,
    lastLoginAt: overrides.lastLoginAt ?? null,
    usernameChangedAt: null,
    deletedAt: null,
    bio: null,
    reputationPoints: 0,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: overrides.lastSeenAt ?? null,
  };
}

function makeRepo(initial: UserRow[] = []): UsersRepositoryLike & {
  rows: Map<string, UserRow>;
  mediaRows: Map<string, MediaRowLite>;
} {
  // B1.14: the shared in-memory repo implements the full interface
  // (listUsers/setBan/expireBans included); the spec adds an empty media map.
  const base = makeMemoryUserRepo(initial);
  return { ...base, mediaRows: new Map<string, MediaRowLite>() };
}

function makeService(initial: UserRow[] = []) {
  const repo = makeRepo(initial);
  const events = { emit: vi.fn() } as unknown as EventEmitter2;
  const service = new UsersService(repo, events);
  return { repo, events, service };
}

describe('UsersService (B1.2)', () => {
  it('creates a user and rejects duplicate username/email/phone', async () => {
    const { service } = makeService();
    await service.create({ username: 'amir', email: 'a@ex.ir', phone: '+989121234567' });
    await expect(service.create({ username: 'amir' })).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
    await expect(service.create({ username: 'other', email: 'a@ex.ir' })).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
    await expect(
      service.create({ username: 'other2', phone: '+989121234567' }),
    ).rejects.toMatchObject({ response: { statusCode: 409 } });
  });

  it('changes a role and emits user.role.changed with from/to/actorId', async () => {
    const { service, events } = makeService([row({ id: 'u-1', role: 'user' })]);
    const view = await service.changeRole('u-1', 'moderator', { id: 'actor-1', role: 'admin' });
    expect(view.role).toBe('moderator');
    expect(events.emit).toHaveBeenCalledWith(USER_ROLE_CHANGED, {
      userId: 'u-1',
      from: 'user',
      to: 'moderator',
      actorId: 'actor-1',
    });
  });

  it('refuses privileged role changes unless the actor is a super_admin (403)', async () => {
    const { service } = makeService([
      row({ id: 'root', role: 'super_admin' }),
      row({ id: 'u-2', role: 'user' }),
    ]);
    // An admin cannot touch an admin/super_admin target OR grant the role.
    await expect(
      service.changeRole('root', 'admin', { id: 'adm', role: 'admin' }),
    ).rejects.toMatchObject({ response: { statusCode: 403 } });
    await expect(
      service.changeRole('u-2', 'admin', { id: 'adm', role: 'admin' }),
    ).rejects.toMatchObject({ response: { statusCode: 403 } });
  });

  it('refuses an actor changing their OWN role', async () => {
    const { service } = makeService([row({ id: 'me', role: 'admin' })]);
    await expect(
      service.changeRole('me', 'moderator', { id: 'me', role: 'super_admin' }),
    ).rejects.toMatchObject({ response: { statusCode: 409 } });
  });

  it('refuses role changes on a non-active target', async () => {
    const { service } = makeService([row({ id: 'u-3', role: 'user', status: 'blocked' })]);
    await expect(
      service.changeRole('u-3', 'moderator', { id: 'adm', role: 'super_admin' }),
    ).rejects.toMatchObject({ response: { statusCode: 409 } });
  });

  it('refuses to demote the LAST active super_admin even by a super_admin', async () => {
    const { service } = makeService([
      row({ id: 'root-1', role: 'super_admin', status: 'active' }),
      row({ id: 'root-2', role: 'super_admin', status: 'blocked' }),
    ]);
    await expect(
      service.changeRole('root-1', 'admin', { id: 'other', role: 'super_admin' }),
    ).rejects.toMatchObject({ response: { statusCode: 409 } });
  });

  it('allows demotion when another ACTIVE super_admin remains', async () => {
    const { service } = makeService([
      row({ id: 'root-1', role: 'super_admin', status: 'active' }),
      row({ id: 'root-2', role: 'super_admin', status: 'active' }),
    ]);
    const view = await service.changeRole('root-1', 'admin', { id: 'other', role: 'super_admin' });
    expect(view.role).toBe('admin');
  });

  it('blocks and unblocks users, emitting user.status.changed', async () => {
    const { service, events } = makeService([row({ id: 'u-2', role: 'user' })]);
    const blocked = await service.changeStatus('u-2', 'blocked');
    expect(blocked.status).toBe('blocked');
    expect(events.emit).toHaveBeenCalledWith(USER_STATUS_CHANGED, {
      userId: 'u-2',
      from: 'active',
      to: 'blocked',
    });
    expect((await service.changeStatus('u-2', 'active')).status).toBe('active');
  });

  it('refuses to block the last active super_admin', async () => {
    const { service } = makeService([row({ id: 'root', role: 'super_admin' })]);
    await expect(service.changeStatus('root', 'blocked')).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
  });

  it('admin view never contains the password hash', async () => {
    const { service } = makeService([row({ id: 'u-3', passwordHash: '$argon2id$secret' })]);
    const view = service.toAdminView((await service.getById('u-3')) as UserRow);
    expect(JSON.stringify(view)).not.toContain('argon2');
  });
});
