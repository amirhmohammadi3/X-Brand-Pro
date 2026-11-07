import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AdminUser, AdminUserView, UserRole, UserStatus } from '@app/contracts';
import type { UserRow } from '../../db/schema/users.js';
import type { UsersRepositoryLike } from './users.repository.js';

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

/** Emitted when an admin changes a user's role (B1.2; consumed by audit in B1.11). */
export const USER_ROLE_CHANGED = 'user.role.changed';
/** Emitted when a user is blocked/unblocked. */
export const USER_STATUS_CHANGED = 'user.status.changed';
/** B1.14 events for later notification subscribers. */
export const USER_BANNED = 'user.banned';
export const USER_UNBANNED = 'user.unbanned';

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
  moderator: ['users.read'],
  admin: [
    'settings.manage',
    'audit.read',
    'i18n.manage',
    'theme.manage',
    'catalog.manage',
    'users.read',
    'users.manage',
  ],
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

  /**
   * B1.14: an EXPIRED time-boxed ban is treated as not banned — login, the
   * request guard and the session cache all compare through this helper, so
   * a user whose `banned_until` has passed is 'active' even before the
   * users:expire-bans job runs (worst case the guard cache lags 30 s).
   */
  effectiveStatus(row: Pick<UserRow, 'status' | 'bannedUntil'>): UserStatus {
    if (
      row.status === 'blocked' &&
      row.bannedUntil !== null &&
      row.bannedUntil.getTime() <= Date.now()
    ) {
      return 'active';
    }
    return row.status;
  }

  /** Full admin view (B1.14) — extends toAdminView with every admin-acting field. */
  toAdminUser(row: UserRow, sessionsCount: number): AdminUser {
    return {
      ...this.toAdminView(row),
      bio: row.bio,
      locale: row.locale,
      emailVerified: row.emailVerifiedAt !== null,
      phoneVerified: row.phoneVerifiedAt !== null,
      bannedReason: row.bannedReason ?? null,
      bannedUntil: row.bannedUntil ? row.bannedUntil.toISOString() : null,
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      sessionsCount,
    };
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

  /* --- B1.10 profile (façade over the repository; rules live in ProfileService) --- */

  async updateProfile(
    id: string,
    fields: { displayName?: string | null; bio?: string | null; locale?: string | null },
  ): Promise<UserRow> {
    const updated = await this.repo.updateProfile(id, fields);
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return updated;
  }

  async setUsername(id: string, username: string): Promise<UserRow> {
    const updated = await this.repo.setUsername(id, username);
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return updated;
  }

  async setAvatarMediaId(id: string, mediaId: string | null): Promise<UserRow> {
    const updated = await this.repo.setAvatarMediaId(id, mediaId);
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return updated;
  }

  async findAvatarMedia(id: string) {
    return this.repo.findAvatarMedia(id);
  }

  async anonymizeAndDelete(id: string): Promise<UserRow> {
    const updated = await this.repo.anonymizeAndDelete(id);
    if (!updated) throw new NotFoundException(`User ${id} not found`);
    return updated;
  }

  async markUsernameChanged(id: string, at: Date): Promise<void> {
    await this.repo.markUsernameChanged(id, at);
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
  /** Role rank for hierarchy checks (B1.14): higher wins. */
  private static readonly RANK: Record<UserRole, number> = {
    user: 1,
    owner: 2,
    moderator: 3,
    admin: 4,
    super_admin: 5,
  };

  /**
   * Admin role change (B1.14 hierarchy rules):
   *  - an actor can never change their OWN role;
   *  - granting/removing admin or super_admin requires users.assign_admin
   *    (held only by super_admin) — an admin may set user/owner/moderator only;
   *  - the target must be an active account;
   *  - the last remaining super_admin can never be demoted;
   *  - the target's sessions are revoked so the new role applies at once
   *    (the controller emits user.role.changed → auth subscriber revokes).
   */
  async changeRole(
    targetId: string,
    role: UserRole,
    actor: { id: string | null; role: UserRole | null },
  ): Promise<AdminUserView> {
    const actorRole = actor.role;
    if (!actorRole) throw new ForbiddenException('actor role required');
    const target = await this.getById(targetId);
    if (actor.id && actor.id === targetId) {
      throw new ConflictException('cannot_change_own_role');
    }
    if (target.status !== 'active') {
      throw new ConflictException('target_must_be_active');
    }
    const touchesPrivileged =
      target.role === 'admin' ||
      target.role === 'super_admin' ||
      role === 'admin' ||
      role === 'super_admin';
    if (touchesPrivileged && actorRole !== 'super_admin') {
      throw new ForbiddenException('users.assign_admin required');
    }
    if (target.role === 'super_admin' && role !== 'super_admin') {
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
      actorId: actor.id,
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

  /* --- B1.14 admin users API --- */

  /** Admin list with search/filters/paging; `sessionsCount` filled by the caller. */
  async listUsers(query: {
    q?: string;
    role?: UserRole;
    status?: UserStatus;
    sort: 'createdAt' | 'lastLoginAt' | 'username';
    direction: 'asc' | 'desc';
    page: number;
    pageSize: number;
  }): Promise<{ items: UserRow[]; total: number }> {
    // Deleted users are anonymized — they must not appear in admin listings.
    return this.repo.listUsers(query);
  }

  /**
   * Ban (B1.14): sets status blocked + reason + optional time box.
   * Rules: never yourself, never a role at or above your own, never the
   * last super_admin. The controller revokes sessions and clears the
   * guard's status cache; this method owns the invariants and the event.
   */
  async banUser(
    targetId: string,
    actor: { id: string | null; role: UserRole | null },
    fields: { reason: string; until?: Date },
  ): Promise<AdminUserView> {
    const actorRole = actor.role;
    if (!actorRole) throw new ForbiddenException('actor role required');
    const target = await this.getById(targetId);
    if (actor.id && actor.id === targetId) {
      throw new ConflictException('cannot_ban_yourself');
    }
    if (UsersService.RANK[target.role] >= UsersService.RANK[actorRole]) {
      throw new ForbiddenException('target_role_is_equal_or_higher');
    }
    if (target.status === 'deleted') {
      throw new ConflictException('target_is_deleted');
    }
    const bannedUntil = fields.until ?? null;
    if (bannedUntil !== null && bannedUntil.getTime() <= Date.now()) {
      throw new ConflictException('ban_until_must_be_in_the_future');
    }
    const updated = await this.repo.setBan(targetId, {
      status: 'blocked',
      bannedReason: fields.reason,
      bannedUntil,
    });
    if (!updated) throw new NotFoundException(`User ${targetId} not found`);
    this.events.emit(USER_BANNED, {
      userId: targetId,
      actorId: actor.id,
      reason: fields.reason,
      until: bannedUntil ? bannedUntil.toISOString() : null,
    });
    return this.toAdminView(updated);
  }

  /** Lifts any ban (time-boxed or indefinite) and clears the ban fields. */
  async unbanUser(
    targetId: string,
    actor: { id: string | null; role: UserRole | null },
  ): Promise<AdminUserView> {
    void actor;
    const target = await this.getById(targetId);
    if (target.status !== 'blocked') {
      throw new ConflictException('target_is_not_banned');
    }
    const updated = await this.repo.setBan(targetId, {
      status: 'active',
      bannedReason: null,
      bannedUntil: null,
    });
    if (!updated) throw new NotFoundException(`User ${targetId} not found`);
    this.events.emit(USER_UNBANNED, { userId: targetId, actorId: actor.id });
    return this.toAdminView(updated);
  }

  /** Auto-unban job handler (B1.14): lifts expired time-boxed bans. */
  async expireBans(now: Date): Promise<string[]> {
    return this.repo.expireBans(now);
  }
}
