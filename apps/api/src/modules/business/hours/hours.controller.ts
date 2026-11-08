import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  replaceWeeklyHoursBodySchema,
  upsertSpecialDayBodySchema,
  type ReplaceWeeklyHoursBody,
  type UpsertSpecialDayBody,
  type BusinessStatus,
} from '@app/contracts';
import { Public } from '../../../common/decorators/public.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { HoursService } from './hours.service.js';
import {
  assertCanManageBusiness,
  canViewBusinessHours,
  type BusinessActor,
} from '../business-access.js';

/** The req.user shape set by JwtAuthGuard (undefined on @Public routes). */
function userOf(req: Request): BusinessActor | undefined {
  const u = (req as Request & { user?: { id: string; role: string } }).user;
  return u ? { id: u.id, role: u.role } : undefined;
}

/** Validate a `YYYY-MM-DD` path param, throwing 400 otherwise. */
function parseDateParam(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'date must be YYYY-MM-DD',
    });
  }
  const parts = raw.split('-').map(Number);
  const y = parts[0] ?? NaN;
  const m = parts[1] ?? NaN;
  const d = parts[2] ?? NaN;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'date must be a real calendar date',
    });
  }
  return raw;
}

/**
 * Business opening-hours endpoints (B2.5). The GET is public for active
 * businesses (and visible to the owner / a `businesses.manage` holder for
 * non-active ones, answering 404 otherwise to avoid leaking existence). The
 * writes require `assertCanManageBusiness` (owner of an editable-status
 * business, or `businesses.manage`). The city's IANA timezone drives the
 * open-now computation.
 */
@Controller()
export class HoursController {
  constructor(private readonly hours: HoursService) {}

  @Public()
  @Get('businesses/:id/hours')
  @RateLimit({ name: 'business.hours.read', limit: 120, windowSec: 60 })
  async getHours(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.hours.getBusinessContext(id);
    const viewer = userOf(req);
    if (
      !canViewBusinessHours(viewer, {
        ownerId: ctx.ownerId,
        status: ctx.status as BusinessStatus,
      })
    ) {
      // Non-active business the caller may not see → 404, never 403.
      throw new NotFoundException(`Business ${id} not found`);
    }
    return this.hours.getHoursResponse(id, ctx.timezone);
  }

  @Put('businesses/:id/hours')
  @RateLimit({ name: 'business.hours.write', limit: 60, windowSec: 60, scope: 'user' })
  async replaceWeekly(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replaceWeeklyHoursBodySchema)) body: ReplaceWeeklyHoursBody,
  ) {
    const ctx = await this.hours.getBusinessContext(id);
    const user = userOf(req);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status as BusinessStatus });
    const weekly = await this.hours.replaceWeekly(id, body.weekly);
    return { weekly };
  }

  @Put('businesses/:id/special-days/:date')
  @RateLimit({ name: 'business.hours.write', limit: 60, windowSec: 60, scope: 'user' })
  async upsertSpecialDay(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('date') dateRaw: string,
    @Body(new ZodValidationPipe(upsertSpecialDayBodySchema)) body: UpsertSpecialDayBody,
  ) {
    const date = parseDateParam(dateRaw);
    const ctx = await this.hours.getBusinessContext(id);
    const user = userOf(req);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status as BusinessStatus });
    return this.hours.upsertSpecialDay(id, date, body);
  }

  @Delete('businesses/:id/special-days/:date')
  @RateLimit({ name: 'business.hours.write', limit: 60, windowSec: 60, scope: 'user' })
  async deleteSpecialDay(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('date') dateRaw: string,
  ) {
    const date = parseDateParam(dateRaw);
    const ctx = await this.hours.getBusinessContext(id);
    const user = userOf(req);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status as BusinessStatus });
    await this.hours.deleteSpecialDay(id, date);
    return { ok: true };
  }
}
