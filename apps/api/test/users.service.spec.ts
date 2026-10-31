import { describe, expect, it, vi } from 'vitest';
import { type EventEmitter2 } from '@nestjs/event-emitter';
import {
  UsersService,
  USER_ROLE_CHANGED,
  USER_STATUS_CHANGED,
} from '../src/modules/users/users.service.js';
import type { UsersRepositoryLike } from '../src/modules/users/users.repository.js';
import type { UserRow } from '../src/db/schema/users.js';
import type { UserRole } from '@app/contracts';

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
    emailVerifiedAt: overrides.emailVerifiedAt ?? null,
    phoneVerifiedAt: overrides.phoneVerifiedAt ?? null,
    bannedUntil: overrides.bannedUntil ?? null,
    lastLoginAt: overrides.lastLoginAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: overrides.lastSeenAt ?? null,
  };
}

function makeRepo(initial: UserRow[] = []): UsersRepositoryLike & { rows: Map<string, UserRow> } {
  const rows = new Map<string, UserRow>(initial.map((r) => [r.id, r]));
  return {
    rows,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByUsername(username) {
      return [...rows.values()].find((r) => r.username === username) ?? null;
    },
    async findByEmail(email) {
      return [...rows.values()].find((r) => r.email === email) ?? null;
    },
    async findByPhone(phone) {
      return [...rows.values()].find((r) => r.phone === phone) ?? null;
    },
    async findByIdentifier(identifier) {
      return (
        [...rows.values()].find(
          (r) => r.username === identifier || r.email === identifier || r.phone === identifier,
        ) ?? null
      );
    },
    async create(params) {
      const created = row({
        id: `u-${rows.size + 1}`,
        username: params.username,
        email: params.email ?? null,
        phone: params.phone ?? null,
        passwordHash: params.passwordHash ?? null,
        role: params.role ?? 'user',
        displayName: params.displayName ?? null,
        locale: params.locale ?? null,
        emailVerifiedAt: params.emailVerified ? new Date() : null,
        phoneVerifiedAt: params.phoneVerified ? new Date() : null,
      });
      rows.set(created.id, created);
      return created;
    },
    async updateRole(id, role: UserRole) {
      const r = rows.get(id);
      if (!r) return null;
      const updated = { ...r, role, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async updateStatus(id, status) {
      const r = rows.get(id);
      if (!r) return null;
      const updated = { ...r, status, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async countByRole(role, status) {
      return [...rows.values()].filter(
        (r) => r.role === role && (status ? r.status === status : true),
      ).length;
    },
    async touchLastSeen() {
      return undefined;
    },
    async setPasswordHash(id, passwordHash) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, passwordHash, updatedAt: new Date() });
    },
    async recordLogin(id) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, lastLoginAt: new Date(), lastSeenAt: new Date() });
    },
  };
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

  it('changes a role and emits user.role.changed with from/to', async () => {
    const { service, events } = makeService([row({ id: 'u-1', role: 'user' })]);
    const view = await service.changeRole('u-1', 'moderator', 'admin');
    expect(view.role).toBe('moderator');
    expect(events.emit).toHaveBeenCalledWith(USER_ROLE_CHANGED, {
      userId: 'u-1',
      from: 'user',
      to: 'moderator',
    });
  });

  it('refuses to demote a super_admin unless the actor is a super_admin', async () => {
    const { service } = makeService([row({ id: 'root', role: 'super_admin' })]);
    await expect(service.changeRole('root', 'admin', 'admin')).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
    // Even a super_admin actor cannot demote the ONLY active super_admin.
    await expect(service.changeRole('root', 'admin', 'super_admin')).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
  });

  it('refuses to demote the LAST active super_admin even by a super_admin', async () => {
    const { service } = makeService([
      row({ id: 'root-1', role: 'super_admin', status: 'active' }),
      row({ id: 'root-2', role: 'super_admin', status: 'blocked' }),
    ]);
    await expect(service.changeRole('root-1', 'admin', 'super_admin')).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
  });

  it('allows demotion when another ACTIVE super_admin remains', async () => {
    const { service } = makeService([
      row({ id: 'root-1', role: 'super_admin', status: 'active' }),
      row({ id: 'root-2', role: 'super_admin', status: 'active' }),
    ]);
    const view = await service.changeRole('root-1', 'admin', 'super_admin');
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
