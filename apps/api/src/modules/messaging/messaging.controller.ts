import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  MESSAGING_MODERATION_LIMIT_PER_MIN,
  MESSAGING_READ_LIMIT_PER_MIN,
  MESSAGING_WRITE_LIMIT_PER_MIN,
  blockUserBodySchema,
  conversationMessagesQuerySchema,
  createConversationBodySchema,
  markReadBodySchema,
  reportMessageBodySchema,
  sendMessageBodySchema,
  type BlockUserBody,
  type ConversationMessagesQuery,
  type CreateConversationBody,
  type MarkReadBody,
  type ReportMessageBody,
  type SendMessageBody,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MessagingService } from './messaging.service.js';

/** The req.user shape set by JwtAuthGuard (this module has no @Public routes). */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  return user;
}

/** Actor + request info for the audit row (mirrors qa.controller). */
function auditInfo(req: Request): {
  actor: { id: string | null; role: string | null };
  request: { ip: string | null; userAgent: string | null; requestId: string | null };
} {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  const ua = req.headers['user-agent'];
  const rid = req.headers['x-request-id'];
  return {
    actor: { id: user?.id ?? null, role: user?.role ?? null },
    request: {
      ip: req.ip ?? null,
      userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
      requestId: typeof rid === 'string' ? rid : null,
    },
  };
}

/** Path params must be UUIDs — a garbage id answers 422, never a 500 from the DB. */
function assertUuid(raw: string, what: string): string {
  if (!uuidSchema.safeParse(raw).success) {
    throw new UnprocessableEntityException({
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message: `${what} must be a UUID`,
      details: { [what]: raw },
    });
  }
  return raw;
}

/**
 * Messaging endpoints (B5.6). Every route is authenticated (the global
 * JwtAuthGuard — no @Public here). Rate limits (contracts constants):
 * reads 60/min, writes 30/min, block/report 30/min — all scope user.
 * Message traffic itself is NOT audited (chat volume would flood the log);
 * the moderation-adjacent writes (block, report) ARE — every other domain
 * audits writes, but blocks/reports are the ones an admin will ever ask
 * "who did this" about.
 *
 * Route layout:
 * - POST   /messaging/conversations              — get-or-create a DM
 * - GET    /messaging/conversations              — the inbox (paged)
 * - GET    /messaging/conversations/:id/messages — the thread (paged)
 * - POST   /messaging/conversations/:id/messages — send (body/attachment)
 * - POST   /messaging/conversations/:id/read     — advance the read receipt
 * - DELETE /messaging/messages/:id               — soft-delete own message
 * - POST   /messaging/messages/:id/report        — report into moderation
 * - POST   /messaging/blocks                     — block a user
 * - DELETE /messaging/blocks/:userId             — unblock (idempotent)
 * - GET    /messaging/blocks                     — the block list
 */
@Controller()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── conversations ───────────────────────────────────────────────────────

  @Post('messaging/conversations')
  @RateLimit({
    name: 'messaging.write',
    limit: MESSAGING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async createConversation(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createConversationBodySchema)) body: CreateConversationBody,
  ) {
    const user = requireUser(req);
    return this.messaging.createConversation(user.id, body.peerId);
  }

  @Get('messaging/conversations')
  @RateLimit({
    name: 'messaging.read',
    limit: MESSAGING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async inbox(
    @Req() req: Request,
    @Query(new ZodValidationPipe(conversationMessagesQuerySchema)) query: ConversationMessagesQuery,
  ) {
    const user = requireUser(req);
    return this.messaging.inbox(user.id, query);
  }

  @Get('messaging/conversations/:id/messages')
  @RateLimit({
    name: 'messaging.read',
    limit: MESSAGING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async messages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(conversationMessagesQuerySchema)) query: ConversationMessagesQuery,
  ) {
    assertUuid(id, 'conversationId');
    const user = requireUser(req);
    return this.messaging.messages(user.id, id, query);
  }

  @Post('messaging/conversations/:id/messages')
  @RateLimit({
    name: 'messaging.write',
    limit: MESSAGING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async sendMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageBodySchema)) body: SendMessageBody,
  ) {
    assertUuid(id, 'conversationId');
    const user = requireUser(req);
    return this.messaging.sendMessage(user.id, id, body);
  }

  @Post('messaging/conversations/:id/read')
  @RateLimit({
    name: 'messaging.write',
    limit: MESSAGING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async markRead(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markReadBodySchema)) body: MarkReadBody,
  ) {
    assertUuid(id, 'conversationId');
    const user = requireUser(req);
    return this.messaging.markRead(user.id, id, body.messageId);
  }

  @Delete('messaging/messages/:id')
  @RateLimit({
    name: 'messaging.write',
    limit: MESSAGING_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async deleteMessage(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'messageId');
    const user = requireUser(req);
    return this.messaging.deleteMessage(user.id, id);
  }

  // ─── reports + blocks (moderation-adjacent, audited) ─────────────────────

  @Post('messaging/messages/:id/report')
  @RateLimit({
    name: 'messaging.moderation',
    limit: MESSAGING_MODERATION_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async reportMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reportMessageBodySchema)) body: ReportMessageBody,
  ) {
    assertUuid(id, 'messageId');
    const user = requireUser(req);
    const result = await this.messaging.reportMessage(user.id, id, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'message.report',
      entityType: 'message',
      entityId: id,
      after: { reportId: result.reportId, reason: body.reason },
      request,
    });
    return result;
  }

  @Post('messaging/blocks')
  @RateLimit({
    name: 'messaging.moderation',
    limit: MESSAGING_MODERATION_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async block(
    @Req() req: Request,
    @Body(new ZodValidationPipe(blockUserBodySchema)) body: BlockUserBody,
  ) {
    const user = requireUser(req);
    const result = await this.messaging.blockUser(user.id, body.userId);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'user.block',
      entityType: 'user',
      entityId: body.userId,
      after: { blocked: true },
      request,
    });
    return result;
  }

  @Delete('messaging/blocks/:userId')
  @RateLimit({
    name: 'messaging.moderation',
    limit: MESSAGING_MODERATION_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async unblock(@Req() req: Request, @Param('userId') userId: string) {
    assertUuid(userId, 'userId');
    const user = requireUser(req);
    const result = await this.messaging.unblockUser(user.id, userId);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'user.unblock',
      entityType: 'user',
      entityId: userId,
      after: { blocked: false },
      request,
    });
    return result;
  }

  @Get('messaging/blocks')
  @RateLimit({
    name: 'messaging.read',
    limit: MESSAGING_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listBlocks(@Req() req: Request) {
    const user = requireUser(req);
    return this.messaging.listBlocks(user.id);
  }
}
