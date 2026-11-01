import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AdminUserView, UserRole, UserStatus } from '@app/contracts';
import type { UserRow } from '../../db/schema/users.js';
import type { UsersRepositoryLike } from './users.repository.js';

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

/** Emitted when an admin changes a user's role (B1.2; consumed by audit in B1.11). */
export const USER_ROLE_CHANGED = 'user.role.changed';
/** Emitted when a user is blocked/unblocked. */
export const USER_STATUS_CHANGED = 'user.status.changed';

/** RBAC semantics (see roles.guard.ts): exact role, super_admin passes everything. */
export function roleSatisfies(userRole: UserRole, required: readonly string[]): boolean {
  if (userRole === 'super_admin') return true;
  return required.includes(userRole);
}

/**
 * Static role → permission map (B1.5). Feature prompts register their
 * permission names here as they introduce guarded endpoints; there is no
 * per-user override table yet (a follow-up when B1.14 lands).
 * `*` means every permission.
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly string[]>> = {
  user: [],
  owner: [],
  moderator: [],
  admin: ['settings.manage'],
  super_admin: ['*'],
};

/** True when the role holds EVERY listed permission (ALL-of semantics). */
export function roleHasPermissions(userRole: UserRole, required: readonly string[]): boolean {
  const held = ROLE_PERMISSIONS[userRole] ?? [];
  if (held.includes('*')) return true;
  return required.every((permission) => held.includes(permission));
}

/**
 * Users domain service (B1.2). The auth prompts (B1.3, B1.7, B1.8) use
 * `create`/lookup methods; the admin API (B1.14) uses the role/status
 * mutations, which enforce the invariant that the system always keeps at
 * least one active super_admin.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: UsersRepositoryLike,
    private readonly events: EventEmitter2,
  ) {}

  toAdminView(row: UserRow): AdminUserView {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      phone: row.phone,
      role: row.role,
      status: row.status,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getById(id: string): Promise<UserRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`User ${id} not found`);
    return row;
  }

  async getByUsername(username: string): Promise<UserRow | null> {
    return this.repo.findByUsername(username);
  }

  /** Exact email lookup (B1.8 OAuth linking). */
  async getByEmail(email: string): Promise<UserRow | null> {
    return this.repo.findByEmail(email);
  }

  async getByIdentifier(identifier: string): Promise<UserRow | null> {
    return this.repo.findByIdentifier(identifier);
  }

  /** True while a temporary ban window (B1.3 `banned_until`) is in the future. */
  isCurrentlyBanned(row: Pick<UserRow, 'bannedUntil'>): boolean {
    return row.bannedUntil !== null && row.bannedUntil.getTime() > Date.now();
  }

  /** B1.3: store a (re)hashed password — register, rehash-on-login, B1.7 reset. */
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repo.setPasswordHash(id, passwordHash);
  }

  /** B1.3: stamp last_login_at (and last_seen_at) on successful login. */
  async recordLogin(id: string): Promise<void> {
    await this.repo.recordLogin(id);
  }

  /**
   * B1.7: attach an OTP-proven identifier and stamp it verified. 'conflict'
   * means a VERIFIED other holder exists — the caller maps it to 409.
   */
  async attachIdentifier(params: {
    userId: string;
    channel: 'email' | 'phone';
    target: string;
  }): Promise<'attached' | 'conflict'> {
    return this.repo.attachIdentifier(params);
  }

  async create(params: {
    username: string;
    email?: string | null;
    phone?: string | null;
    passwordHash?: string | null;
    role?: UserRole;
    displayName?: string | null;
    locale?: string | null;
    emailVerified?: boolean;
    phoneVerified?: boolean;
  }): Promise<UserRow> {
    const existingUsername = await this.repo.findByUsername(params.username);
    if (existingUsername) {
      throw new ConflictException('username_taken');
    }
    if (params.email) {
      const existingEmail = await this.repo.findByEmail(params.email);
      if (existingEmail) throw new ConflictException('email_taken');
    }
    if (params.phone) {
      const existingPhone = await this.repo.findByPhone(params.phone);
      if (existingPhone) throw new ConflictException('phone_taken');
    }
    return this.repo.create(params);
  }

  /**
   * Admin role change. Guards: target must exist; the LAST active
   * super_admin cannot be demoted (the system must stay administrable);
   * a super_admin cannot be demoted by anyone but a super_admin (checked by
   * the caller's identity in B1.14 — the rule lives here).
   */
  async changeRole(targetId: string, role: UserRole, actorRole?: UserRole): Promise<AdminUserView> {
    const target = await this.getById(targetId);
    if (target.role === 'super_admin' && role !== 'super_admin') {
      if (actorRole !== 'super_admin') {
        throw new ConflictException('only_super_admin_can_demote_super_admin');
      }
      const supers = await this.countActiveSuperAdmins();
      if (supers <= 1) {
        throw new ConflictException('last_super_admin_cannot_be_demoted');
      }
    }
    const updated = await this.repo.updateRole(targetId, role);
    if (!updated) throw new NotFoundException(`User ${targetId} not found`);
    this.events.emit(USER_ROLE_CHANGED, {
      userId: targetId,
      from: target.role,
      to: role,
    });
    return this.toAdminView(updated);
  }

  /** Blocking prevents login (B1.3 checks status) but never locks out the last super_admin. */
  async changeStatus(targetId: string, status: UserStatus): Promise<AdminUserView> {
    const target = await this.getById(targetId);
    if (target.role === 'super_admin' && target.status === 'active' && status === 'blocked') {
      const supers = await this.countActiveSuperAdmins();
      if (supers <= 1) throw new ConflictException('last_super_admin_cannot_be_blocked');
    }
    const updated = await this.repo.updateStatus(targetId, status);
    if (!updated) throw new NotFoundException(`User ${targetId} not found`);
    this.events.emit(USER_STATUS_CHANGED, { userId: targetId, from: target.status, to: status });
    return this.toAdminView(updated);
  }

  private async countActiveSuperAdmins(): Promise<number> {
    // Uses a direct drizzle count via the repository's db handle? No — the
    // repository owns queries; countByRole is part of the contract.
    return this.repo.countByRole('super_admin', 'active');
  }
}
