import { Controller, Get, HttpException, HttpStatus, Inject, Query } from '@nestjs/common';
import { auditListQuerySchema, type AuditListResponse } from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_REPOSITORY, decodeAuditCursor, encodeAuditCursor } from './audit.repository.js';
import type { AuditListRow, AuditRepository } from './audit.repository.js';

/**
 * Admin audit trail reader (B1.11). Cursor-paginated (newest first, stable
 * while rows land) with exact/prefix action filters. Permission
 * `audit.read` — admins and super_admins.
 */
@Controller('admin/audit-logs')
export class AuditAdminController {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository) {}

  @Get()
  @RequirePermissions('audit.read')
  @RateLimit({ name: 'admin.audit.read', limit: 60, windowSec: 60, scope: 'user' })
  async list(
    @Query(new ZodValidationPipe(auditListQuerySchema))
    query: {
      cursor?: string;
      limit?: number;
      actorId?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
    },
  ): Promise<AuditListResponse> {
    const limit = query.limit ?? 20;
    let cursor: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursor = decodeAuditCursor(query.cursor);
      if (!cursor) {
        throw new HttpException(
          { code: 'VALIDATION_FAILED' as const, message: 'Malformed cursor' },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const rows: AuditListRow[] = await this.repo.list(
      {
        actorId: query.actorId,
        action: query.action,
        entityType: query.entityType,
        entityId: query.entityId,
        from: query.from,
        to: query.to,
      },
      cursor,
      limit,
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actor,
        actorRole: row.actorRole,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: {
        hasMore,
        nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
      },
    };
  }
}
