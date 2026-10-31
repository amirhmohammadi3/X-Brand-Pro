import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import type { UserRole, UserStatus } from '@app/contracts';

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
  touchLastSeen(id: string): Promise<void>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
  recordLogin(id: string): Promise<void>;
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
}
