import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { sessions, type SessionRow } from '../../db/schema/sessions.js';

/** DI token for the sessions repository (faked in unit/API tests). */
export const SESSIONS_REPOSITORY = Symbol('SESSIONS_REPOSITORY');

/**
 * Narrow Drizzle surface for the sessions domain (AGENTS.md 6). Faked in
 * unit/API tests with an in-memory implementation.
 */
export interface SessionsRepositoryLike {
  insert(row: {
    userId: string;
    familyId: string;
    refreshHash: string;
    userAgent: string | null;
    ip: string | null;
    expiresAt: Date;
  }): Promise<SessionRow>;
  findByRefreshHash(hash: string): Promise<SessionRow | null>;
  findById(id: string): Promise<SessionRow | null>;
  markReplaced(id: string, replacedBy: string): Promise<void>;
  revoke(id: string, reason: string): Promise<void>;
  revokeFamily(familyId: string, reason: string, exceptId?: string): Promise<number>;
  listActiveForUser(userId: string): Promise<SessionRow[]>;
  touchUsed(id: string, when: Date): Promise<void>;
}

@Injectable()
export class SessionsRepository implements SessionsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async insert(row: {
    userId: string;
    familyId: string;
    refreshHash: string;
    userAgent: string | null;
    ip: string | null;
    expiresAt: Date;
  }): Promise<SessionRow> {
    const rows = await this.client.db.insert(sessions).values(row).returning();
    const created = rows[0];
    if (!created) throw new Error('sessions insert returned no row');
    return created;
  }

  async findByRefreshHash(hash: string): Promise<SessionRow | null> {
    const rows = await this.client.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshHash, hash))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<SessionRow | null> {
    const rows = await this.client.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async markReplaced(id: string, replacedBy: string): Promise<void> {
    await this.client.db.update(sessions).set({ replacedBy }).where(eq(sessions.id, id));
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.client.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revokeFamily(familyId: string, reason: string, exceptId?: string): Promise<number> {
    const conditions = [eq(sessions.familyId, familyId), isNull(sessions.revokedAt)];
    if (exceptId) conditions.push(ne(sessions.id, exceptId));
    const rows = await this.client.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: sessions.id });
    return rows.length;
  }

  async listActiveForUser(userId: string): Promise<SessionRow[]> {
    return this.client.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async touchUsed(id: string, when: Date): Promise<void> {
    await this.client.db.update(sessions).set({ lastUsedAt: when }).where(eq(sessions.id, id));
  }
}
