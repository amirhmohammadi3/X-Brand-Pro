import { Controller, Get, Inject, Post, Put, Query, Req, Body } from '@nestjs/common';
import type { Request } from 'express';
import type {
  PageQuery,
  MarkNotificationsReadBody,
  UpdateNotificationPreferenceBody,
} from '@app/contracts';
import {
  NOTIFICATION_READ_LIMIT_PER_MIN,
  NOTIFICATION_WRITE_LIMIT_PER_MIN,
  markNotificationsReadBodySchema,
  pageQuerySchema,
  updateNotificationPreferenceBodySchema,
  type NotificationPreferencesResult,
  type NotificationEventsCatalogResult,
  type NotificationInboxResult,
  type MarkNotificationsReadResult,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationsService } from './notifications.service.js';

/** The req.user shape set by JwtAuthGuard (this module has no @Public routes). */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  return user;
}

/**
 * Notification endpoints (B5.3). Every route is authenticated (the global
 * JwtAuthGuard — no @Public): the inbox, preferences and catalog are
 * per-user reads. Reads 60/min per user, writes (preference + mark-read)
 * 30/min per user. Preference writes are NOT audited — they are private
 * UI state, not security-relevant data (the audit log keeps write noise
 * low for the events that matter).
 *
 * Route layout:
 * - GET /notifications/events            — the catalog (defaults per event)
 * - GET /notifications/me/inbox          — page + unread total
 * - GET /notifications/me/preferences    — effective matrix per event
 * - PUT /notifications/me/preferences    — partial channel merge
 * - POST /notifications/me/read          — mark ids / all read
 */
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  @Get('notifications/events')
  @RateLimit({
    name: 'notifications.read',
    limit: NOTIFICATION_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async catalog(@Req() req: Request): Promise<NotificationEventsCatalogResult> {
    requireUser(req);
    return this.notifications.listCatalog();
  }

  @Get('notifications/me/inbox')
  @RateLimit({
    name: 'notifications.read',
    limit: NOTIFICATION_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async inbox(
    @Req() req: Request,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<NotificationInboxResult> {
    const user = requireUser(req);
    return this.notifications.listInbox(user.id, query);
  }

  @Get('notifications/me/preferences')
  @RateLimit({
    name: 'notifications.read',
    limit: NOTIFICATION_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async preferences(@Req() req: Request): Promise<NotificationPreferencesResult> {
    const user = requireUser(req);
    return this.notifications.listPreferences(user.id);
  }

  @Put('notifications/me/preferences')
  @RateLimit({
    name: 'notifications.write',
    limit: NOTIFICATION_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async updatePreference(
    @Req() req: Request,
    @Body(new ZodValidationPipe(updateNotificationPreferenceBodySchema))
    body: UpdateNotificationPreferenceBody,
  ) {
    const user = requireUser(req);
    return this.notifications.updatePreference(user.id, body);
  }

  @Post('notifications/me/read')
  @RateLimit({
    name: 'notifications.write',
    limit: NOTIFICATION_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async markRead(
    @Req() req: Request,
    @Body(new ZodValidationPipe(markNotificationsReadBodySchema)) body: MarkNotificationsReadBody,
  ): Promise<MarkNotificationsReadResult> {
    const user = requireUser(req);
    const result = await this.notifications.markRead(user.id, body);
    // One audit row for the batch (not per id) — mark-all can sweep hundreds.
    const ua = req.headers['user-agent'];
    const rid = req.headers['x-request-id'];
    this.audit.log({
      actor: { id: user.id, role: user.role },
      action: 'notification.read',
      entityType: 'notification',
      entityId: user.id,
      after: { all: body.all === true, count: result.marked },
      request: {
        ip: req.ip ?? null,
        userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
        requestId: typeof rid === 'string' ? rid : null,
      },
    });
    return result;
  }
}
