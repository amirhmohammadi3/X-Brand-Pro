import { z } from 'zod';
import { cursorMetaSchema, cursorQuerySchema } from './pagination.js';
import { usernameSchema } from './primitives.js';

/**
 * Audit log wire shapes (B1.11). The audit trail records security-relevant
 * actions (auth events, settings changes, later: moderation, payments).
 * Secrets are redacted BEFORE a row is written — `before`/`after` payloads
 * never contain raw credential material.
 */

export const auditActionSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'audit.action_format');
export type AuditAction = z.infer<typeof auditActionSchema>;

/** One audit trail entry as the admin API returns it. */
export const auditLogSchema = z.object({
  id: z.string().uuid(),
  action: auditActionSchema,
  actor: z
    .object({
      id: z.string().uuid(),
      username: usernameSchema,
    })
    .nullable(),
  actorRole: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** GET /admin/audit-logs query. `action` matches exactly or by prefix with a trailing `*`. */
export const auditListQuerySchema = cursorQuerySchema
  .extend({
    actorId: z.string().uuid().optional(),
    action: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9._*-]+$/, 'audit.action_filter_format')
      .optional(),
    entityType: z.string().min(1).max(60).optional(),
    entityId: z.string().min(1).max(100).optional(),
    from: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), 'audit.invalid_from')
      .optional(),
    to: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), 'audit.invalid_to')
      .optional(),
  })
  .strict();
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditListResponseSchema = z.object({
  items: z.array(auditLogSchema),
  meta: cursorMetaSchema,
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;
