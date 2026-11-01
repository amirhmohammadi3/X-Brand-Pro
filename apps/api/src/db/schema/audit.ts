import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Audit trail (B1.11). Append-only; rows are written through AuditService.log
 * with redaction applied BEFORE insert. Retention: keep 2 years
 * (docs/DATA_MODEL.md) — a purge job arrives with the retention prompts.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null when the actor is a deleted user (fk on delete set null) or the
    // action has no user context (e.g. a session-scoped revocation).
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'), // inet values as text — validation happens upstream
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_created_id_idx').on(table.createdAt.desc(), table.id.desc()),
    index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt.desc()),
    index('audit_logs_action_created_idx').on(table.action, table.createdAt.desc()),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
