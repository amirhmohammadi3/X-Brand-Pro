import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { auditLogs } from '../../db/schema/audit.js';
import type { NewAuditLogRow } from '../../db/schema/audit.js';

/** DI token for AuditService (tests bind a recording fake). */
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');

/** Keys matching this pattern are redacted before anything reaches storage. */
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|otp|code$/i;

const MAX_DEPTH = 6;
const MAX_STRING = 2000;
const REDACTED = '[redacted]';

export interface AuditActor {
  id?: string | null;
  role?: string | null;
}

export interface AuditRequestInfo {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  actor?: AuditActor | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  request?: AuditRequestInfo | null;
}

/**
 * Deep redaction. Rules (B1.11):
 *  - object keys matching SENSITIVE_KEY (case-insensitive) → `[redacted]`
 *  - nested objects AND arrays are walked
 *  - max depth 6 (deeper levels collapse to `[redacted]`)
 *  - strings longer than 2000 chars are truncated (payloads stay rows, not blobs)
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  // Six object levels are WALKED; anything deeper collapses to the marker.
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

/**
 * Audit trail writer (B1.11). A single INSERT per entry, applied
 * fire-and-forget: callers never await it and a failing write NEVER breaks
 * the request — failures are logged and swallowed (audit must not take the
 * product down).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  /** Fire-and-forget write. Resolves immediately; errors are logged. */
  log(entry: AuditEntry): void {
    void this.write(entry).catch((error: unknown) => {
      this.logger.warn(
        `audit write failed for action "${entry.action}": ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /** Awaitable variant for tests and callers that need the row persisted. */
  async write(entry: AuditEntry): Promise<{ id: string }> {
    const row: NewAuditLogRow = {
      id: randomUUID(),
      actorUserId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: redact(entry.before ?? null) as NewAuditLogRow['before'],
      after: redact(entry.after ?? null) as NewAuditLogRow['after'],
      ip: entry.request?.ip ?? null,
      userAgent: entry.request?.userAgent ?? null,
      requestId: entry.request?.requestId ?? null,
    };
    const rows = await this.client.db.insert(auditLogs).values(row).returning({ id: auditLogs.id });
    const inserted = rows[0];
    if (!inserted) throw new Error('audit insert returned no row');
    return inserted;
  }
}
