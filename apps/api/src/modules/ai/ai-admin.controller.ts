import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  aiCallLogQuerySchema,
  aiTestBodySchema,
  type AiCallLogQuery,
  type AiCallLogResult,
  type AiConfig,
  type AiTestBody,
  type AiTestResult,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// AiService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AiService } from './ai.service.js';

/**
 * Admin AI controller (A9.1 + A9.7). Three endpoints:
 *  - GET /admin/ai/config — the admin-readable config (secrets masked);
 *  - POST /admin/ai/test — the "test connection" button (sends a canned
 *    prompt through the configured driver synchronously);
 *  - GET /admin/ai/calls — the paginated call log (the admin "AI calls" tab).
 *
 * All three are admin-only (`settings.manage` — the same permission that
 * gates the rest of the settings panel, so the existing admin role check
 * covers them). The test endpoint is rate-limited (5/min/user) so a
 * hammering admin can't blow through the token budget.
 */
@Controller('admin/ai')
export class AiAdminController {
  constructor(private readonly ai: AiService) {}

  /** GET /admin/ai/config — the resolved config (secrets masked). */
  @Get('config')
  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.ai.config', limit: 60, windowSec: 60, scope: 'user' })
  async getConfig(): Promise<AiConfig> {
    return this.ai.getConfig();
  }

  /** POST /admin/ai/test — the "test connection" button. */
  @Post('test')
  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.ai.test', limit: 5, windowSec: 60, scope: 'user', failClosed: true })
  async test(
    @Body(new ZodValidationPipe(aiTestBodySchema)) body: AiTestBody,
  ): Promise<AiTestResult> {
    return this.ai.test(body);
  }

  /** GET /admin/ai/calls — the paginated call log. */
  @Get('calls')
  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.ai.calls', limit: 60, windowSec: 60, scope: 'user' })
  async list(
    @Query(new ZodValidationPipe(aiCallLogQuerySchema)) query: AiCallLogQuery,
  ): Promise<AiCallLogResult> {
    return this.ai.listCalls(query);
  }
}
