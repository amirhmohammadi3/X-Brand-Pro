import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import { mediaFiles } from '../../db/schema/media.js';
import type { UserRole, UserStatus } from '@app/contracts';
import { normalizeDigits, normalizePersianText } from '@app/contracts';

/**
 * All Drizzle access for the users domain (AGENTS.md 6). The narrow surface
 * doubles as the fake-able contract for unit tests. Uniqueness conflicts
 * surface as Postgres 23505 — the service translates them to domain errors.
 */
export interface UsersRepositoryLike {
  findById(id: string): Promise<UserRow | null>;
  findByUsername(username: string): Promise<UserRow | null>;
  findByEmail(email: string): Promise<UserRow | null>;
  findByPhone(phone: string): Promise<UserRow | null>;
  findByIdentifier(identifier: string): Promise<UserRow | null>;
  create(params: {
    username: string;
    email?: string | null;
    phone?: string | null;
    passwordHash?: string | null;
    role?: UserRole;
    displayName?: string | null;
    locale?: string | null;
    emailVerified?: boolean;
    phoneVerified?: boolean;
  }): Promise<UserRow>;
  updateRole(id: string, role: UserRole): Promise<UserRow | null>;
  updateStatus(id: string, status: UserStatus): Promise<UserRow | null>;
  countByRole(role: UserRole, status?: UserStatus): Promise<number>;
  /* --- B1.14 admin users --- */
  listUsers(query: {
    q?: string;
    role?: UserRole;
    status?: UserStatus;
    sort: 'createdAt' | 'lastLoginAt' | 'username';
    direction: 'asc' | 'desc';
    page: number;
    pageSize: number;
  }): Promise<{ items: UserRow[]; total: number }>;
  setBan(
    id: string,
    fields: { status: UserStatus; bannedReason: string | null; bannedUntil: Date | null },
  ): Promise<UserRow | null>;
  expireBans(now: Date): Promise<string[]>;
  touchLastSeen(id: string): Promise<void>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
  recordLogin(id: string): Promise<void>;
  /* --- B1.10 profile --- */
  updateProfile(
    id: string,
    fields: { displayName?: string | null; bio?: string | null; locale?: string | null },
  ): Promise<UserRow | null>;
  setUsername(id: string, username: string): Promise<UserRow | null>;
  setAvatarMediaId(id: string, mediaId: string | null): Promise<UserRow | null>;
  findAvatarMedia(id: string): Promise<{
    key: string;
    thumbKey: string | null;
    deletedAt: Date | null;
    ownerUserId: string | null;
    kind: string;
  } | null>;
  /** B1.10 account deletion: anonymize in one update. */
  anonymizeAndDelete(id: string): Promise<UserRow | null>;
  /** B1.10: stamp username_changed_at with the cooldown anchor. */
  markUsernameChanged(id: string, at: Date): Promise<void>;
  /**
   * B1.7: attach an OTP-proven identifier to a user and stamp it verified,
   * atomically. A VERIFIED holder other than `userId` → 'conflict' (409);
   * an UNVERIFIED other holder loses the identifier (ownership proven by
   * OTP — takeover rule). Returns 'attached' | 'conflict'.
   */
  attachIdentifier(params: {
    userId: string;
    channel: 'email' | 'phone';
    target: string;
  }): Promise<'attached' | 'conflict'>;
}

@Injectable()
export class UsersRepository implements UsersRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findById(id: string): Promise<UserRow | null> {
    const rows = await this.client.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const rows = await this.client.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.client.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    const rows = await this.client.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    return rows[0] ?? null;
  }

  /** One query for login by username OR email OR phone (normalized upstream). */
  async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const rows = await this.client.db
      .select()
      .from(users)
      .where(
        or(
          eq(users.username, identifier),
          eq(users.email, identifier),
          eq(users.phone, identifier),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
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
    const rows = await this.client.db
      .insert(users)
      .values({
        username: params.username,
        email: params.email ?? null,
        phone: params.phone ?? null,
        passwordHash: params.passwordHash ?? null,
        role: params.role ?? 'user',
        displayName: params.displayName ?? null,
        locale: params.locale ?? null,
        emailVerifiedAt: params.emailVerified ? new Date() : null,
        phoneVerifiedAt: params.phoneVerified ? new Date() : null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('users insert returned no row');
    return row;
  }

  async updateRole(id: string, role: UserRole): Promise<UserRow | null> {
    const rows = await this.client.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updateStatus(id: string, status: UserStatus): Promise<UserRow | null> {
    const rows = await this.client.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async countByRole(role: UserRole, status?: UserStatus): Promise<number> {
    const rows = await this.client.db
      .select({ id: users.id })
      .from(users)
      .where(status ? and(eq(users.role, role), eq(users.status, status)) : eq(users.role, role));
    return rows.length;
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.client.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, id));
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.client.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async recordLogin(id: string): Promise<void> {
    const now = new Date();
    await this.client.db
      .update(users)
      .set({ lastLoginAt: now, lastSeenAt: now })
      .where(eq(users.id, id));
  }

  /* --- B1.10 profile --- */

  async updateProfile(
    id: string,
    fields: { displayName?: string | null; bio?: string | null; locale?: string | null },
  ): Promise<UserRow | null> {
    const rows = await this.client.db
      .update(users)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async setUsername(id: string, username: string): Promise<UserRow | null> {
    const rows = await this.client.db
      .update(users)
      .set({ username, usernameChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async setAvatarMediaId(id: string, mediaId: string | null): Promise<UserRow | null> {
    const rows = await this.client.db
      .update(users)
      .set({ avatarMediaId: mediaId, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async findAvatarMedia(id: string) {
    if (!id) return null;
    const rows = await this.client.db
      .select({
        key: mediaFiles.key,
        thumbKey: mediaFiles.thumbKey,
        deletedAt: mediaFiles.deletedAt,
        ownerUserId: mediaFiles.ownerUserId,
        kind: mediaFiles.kind,
      })
      .from(users)
      .innerJoin(mediaFiles, eq(users.avatarMediaId, mediaFiles.id))
      .where(eq(users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async anonymizeAndDelete(id: string): Promise<UserRow | null> {
    const now = new Date();
    const rows = await this.client.db
      .update(users)
      .set({
        // username stays NOT NULL + unique: derived from the id prefix.
        username: sql`'deleted_' || substring(${users.id}::text, 1, 8)`,
        email: null,
        phone: null,
        passwordHash: null,
        displayName: null,
        bio: null,
        avatarMediaId: null,
        status: 'deleted',
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async markUsernameChanged(id: string, at: Date): Promise<void> {
    await this.client.db
      .update(users)
      .set({ usernameChangedAt: at, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  /** B1.7 attach/verify with the conflict + takeover rules inside one transaction. */
  async attachIdentifier(params: {
    userId: string;
    channel: 'email' | 'phone';
    target: string;
  }): Promise<'attached' | 'conflict'> {
    return this.client.db.transaction(async (tx) => {
      const holders =
        params.channel === 'email'
          ? await tx.select().from(users).where(eq(users.email, params.target))
          : await tx.select().from(users).where(eq(users.phone, params.target));

      for (const holder of holders) {
        if (holder.id === params.userId) continue;
        const verified =
          params.channel === 'email'
            ? holder.emailVerifiedAt !== null
            : holder.phoneVerifiedAt !== null;
        if (verified) return 'conflict';
        // Unverified holder loses the identifier — OTP proved real ownership.
        await tx
          .update(users)
          .set(
            params.channel === 'email'
              ? { email: null, updatedAt: new Date() }
              : { phone: null, updatedAt: new Date() },
          )
          .where(eq(users.id, holder.id));
      }

      await tx
        .update(users)
        .set(
          params.channel === 'email'
            ? { email: params.target, emailVerifiedAt: new Date(), updatedAt: new Date() }
            : { phone: params.target, phoneVerifiedAt: new Date(), updatedAt: new Date() },
        )
        .where(eq(users.id, params.userId));
      return 'attached';
    });
  }

  /* --- B1.14 admin users --- */

  async listUsers(query: {
    q?: string;
    role?: UserRole;
    status?: UserStatus;
    sort: 'createdAt' | 'lastLoginAt' | 'username';
    direction: 'asc' | 'desc';
    page: number;
    pageSize: number;
  }): Promise<{ items: UserRow[]; total: number }> {
    // Anonymized (soft-deleted) rows never appear in admin listings (B1.14).
    const conditions = [isNull(users.deletedAt)];
    if (query.role) conditions.push(eq(users.role, query.role));
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.q) {
      // Trigram-friendly search: normalized + lowercased identity text, and
      // digit-only needles match the phone (Persian digits normalize away).
      const normalized = normalizePersianText(normalizeDigits(query.q));
      const text = '%' + normalized.toLowerCase() + '%';
      const digits = normalized.replace(/[^\d]/g, '');
      const phoneNeedle = digits.length >= 3 ? '%' + digits + '%' : null;
      const match = phoneNeedle
        ? or(
            ilike(users.username, text),
            ilike(users.email, text),
            ilike(users.displayName, text),
            ilike(users.phone, phoneNeedle),
          )
        : or(ilike(users.username, text), ilike(users.email, text), ilike(users.displayName, text));
      if (match) conditions.push(match);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumn =
      query.sort === 'lastLoginAt'
        ? users.lastLoginAt
        : query.sort === 'username'
          ? users.username
          : users.createdAt;
    const direction = query.direction === 'asc' ? asc : desc;

    const items = await this.client.db
      .select()
      .from(users)
      .where(where)
      // AGENTS.md 6: every sort ends with id as the stable tiebreaker.
      .orderBy(direction(sortColumn), asc(users.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const totalRows = await this.client.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(where);
    return { items, total: totalRows[0]?.count ?? 0 };
  }

  async setBan(
    id: string,
    fields: { status: UserStatus; bannedReason: string | null; bannedUntil: Date | null },
  ): Promise<UserRow | null> {
    const rows = await this.client.db
      .update(users)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async expireBans(now: Date): Promise<string[]> {
    // Auto-unban (B1.14): lifts ONLY time-boxed bans whose window has passed;
    // indefinite bans (banned_until null) stay until an admin unbans.
    const rows = await this.client.db
      .update(users)
      .set({ status: 'active', bannedReason: null, bannedUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(users.status, 'blocked'),
          sql`${users.bannedUntil} is not null and ${users.bannedUntil} <= ${now}`,
        ),
      )
      .returning({ id: users.id });
    return rows.map((r) => r.id);
  }
}
