import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, like, lt, lte, or, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { auditLogs } from '../../db/schema/audit.js';
import { users } from '../../db/schema/users.js';

export interface AuditListFilters {
  actorId?: string;
  action?: string; // exact, or prefix filter with a trailing `*`
  entityType?: string;
  entityId?: string;
  from?: string; // ISO
  to?: string; // ISO
}

export interface AuditListRow {
  id: string;
  action: string;
  actor: { id: string; username: string } | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: Date;
}

/**
 * All Drizzle access for the audit domain (AGENTS.md 6). Cursor pagination
 * walks (created_at DESC, id DESC) so paging is stable while new rows land.
 */
/** DI token for the audit repository (faked in tests). */
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditRepositoryLike {
  list(
    filters: AuditListFilters,
    cursor: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<AuditListRow[]>;
}

@Injectable()
export class AuditRepository implements AuditRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async list(
    filters: AuditListFilters,
    cursor: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<AuditListRow[]> {
    const conditions = [];

    if (filters.actorId) conditions.push(eq(auditLogs.actorUserId, filters.actorId));
    if (filters.action) {
      if (filters.action.endsWith('*')) {
        conditions.push(like(auditLogs.action, `${filters.action.slice(0, -1)}%`));
      } else {
        conditions.push(eq(auditLogs.action, filters.action));
      }
    }
    if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
    if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
    if (filters.from) conditions.push(gte(auditLogs.createdAt, new Date(filters.from)));
    if (filters.to) conditions.push(lte(auditLogs.createdAt, new Date(filters.to)));

    // Keyset condition: strictly older than the cursor row.
    if (cursor) {
      conditions.push(
        or(
          lt(auditLogs.createdAt, cursor.createdAt),
          and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
        ),
      );
    }

    // Fetch limit+1 rows to detect hasMore without a second count query.
    const rows = await this.client.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorId: users.id,
        actorUsername: users.username,
        actorRole: auditLogs.actorRole,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        before: auditLogs.before,
        after: auditLogs.after,
        requestId: auditLogs.requestId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : sql`true`)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit + 1);

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor:
        row.actorId && row.actorUsername ? { id: row.actorId, username: row.actorUsername } : null,
      actorRole: row.actorRole,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
      requestId: row.requestId,
      createdAt: row.createdAt,
    }));
  }
}

/** Cursor encoding helpers shared with the controller (opaque to clients). */
export function encodeAuditCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.lastIndexOf('|');
    if (separator <= 0) return null;
    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
