import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  adminUserListQuerySchema,
  banBodySchema,
  changeRoleBodySchema,
  type AdminUser,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type BanBody,
  type ChangeRoleBody,
  type UserRole,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
import { Inject } from '@nestjs/common';
// UsersService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from '../users/users.service.js';
// SessionService is constructor-injected: same DI rule.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SessionService } from './session.service.js';

/**
 * Admin users API (B1.14). Lives in the AUTH module (not UsersModule) for
 * the same reason as ProfileService: it must revoke sessions synchronously
 * through SessionService, and UsersModule cannot import AuthModule without
 * a DI cycle.
 *
 * Permissions: `users.read` (list/detail — moderators may read),
 * `users.manage` (role/ban/unban/revoke-sessions — admins+). Granting or
 * removing admin/super_admin additionally requires the ACTOR to be a
 * super_admin (users.assign_admin) — enforced in UsersService.changeRole.
 * Hierarchy rules (self-target, role rank, last super_admin) live in the
 * service; this controller owns audit rows with before/after.
 */
@Controller('admin/users')
export class UsersAdminController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private actor(req: Request & { user?: { id: string; role: UserRole } }): {
    id: string | null;
    role: UserRole | null;
  } {
    return { id: req.user?.id ?? null, role: req.user?.role ?? null };
  }

  private auditInfo(req: Request): {
    ip: string | null;
    userAgent: string | null;
    requestId: string | null;
  } {
    const ua = req.headers['user-agent'];
    const rid = req.headers['x-request-id'];
    return {
      ip: req.ip ?? null,
      userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
      requestId: typeof rid === 'string' ? rid : null,
    };
  }

  @Get()
  @RequirePermissions('users.read')
  @RateLimit({ name: 'admin.users.read', limit: 120, windowSec: 60, scope: 'user' })
  async list(
    @Query(new ZodValidationPipe(adminUserListQuerySchema)) query: AdminUserListQuery,
  ): Promise<AdminUserListResponse> {
    const { items, total } = await this.users.listUsers({
      q: query.q,
      role: query.role,
      status: query.status,
      sort: query.sort,
      direction: query.direction ?? (query.sort === 'username' ? 'asc' : 'desc'),
      page: query.page,
      pageSize: query.pageSize,
    });
    const counts = await this.sessions.countActiveByUsers(items.map((u) => u.id));
    return {
      items: items.map((row) => this.users.toAdminUser(row, counts.get(row.id) ?? 0)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @RateLimit({ name: 'admin.users.read', limit: 120, windowSec: 60, scope: 'user' })
  async detail(@Param('id') id: string): Promise<AdminUser> {
    const row = await this.users.getById(id);
    const sessionsCount = (await this.sessions.countActiveByUsers([id])).get(id) ?? 0;
    return this.users.toAdminUser(row, sessionsCount);
  }

  @Patch(':id/role')
  @RequirePermissions('users.manage')
  @RateLimit({ name: 'admin.users.write', limit: 120, windowSec: 60, scope: 'user' })
  async changeRole(
    @Req() req: Request & { user?: { id: string; role: UserRole } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeRoleBodySchema)) body: ChangeRoleBody,
  ) {
    const actor = this.actor(req);
    const before = await this.users.getById(id);
    const updated = await this.users.changeRole(id, body.role, actor);
    // The new role applies at once: kill sessions and the status cache.
    await this.sessions.revokeAllForUser(id, actor.id ?? undefined, 'role_changed');
    this.sessions.invalidateStatusCache(id);

    this.audit.log({
      actor,
      action: 'users.role_changed',
      entityType: 'user',
      entityId: id,
      before: { role: before.role },
      after: { role: updated.role },
      request: this.auditInfo(req),
    });
    return updated;
  }

  @Post(':id/ban')
  @RequirePermissions('users.manage')
  @RateLimit({ name: 'admin.users.write', limit: 120, windowSec: 60, scope: 'user' })
  async ban(
    @Req() req: Request & { user?: { id: string; role: UserRole } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(banBodySchema)) body: BanBody,
  ) {
    const actor = this.actor(req);
    const before = await this.users.getById(id);
    const updated = await this.users.banUser(id, actor, {
      reason: body.reason,
      until: body.until ? new Date(body.until) : undefined,
    });
    // Every session dies with the ban; the guard cache drops immediately.
    await this.sessions.revokeAllForUser(id, undefined, 'banned');
    this.sessions.invalidateStatusCache(id);

    this.audit.log({
      actor,
      action: 'users.banned',
      entityType: 'user',
      entityId: id,
      before: { status: before.status, bannedUntil: before.bannedUntil?.toISOString() ?? null },
      after: { status: 'blocked', reason: body.reason, until: body.until ?? null },
      request: this.auditInfo(req),
    });
    return updated;
  }

  @Post(':id/unban')
  @RequirePermissions('users.manage')
  @RateLimit({ name: 'admin.users.write', limit: 120, windowSec: 60, scope: 'user' })
  async unban(
    @Req() req: Request & { user?: { id: string; role: UserRole } },
    @Param('id') id: string,
  ) {
    const actor = this.actor(req);
    const before = await this.users.getById(id);
    const updated = await this.users.unbanUser(id, actor);
    this.sessions.invalidateStatusCache(id);

    this.audit.log({
      actor,
      action: 'users.unbanned',
      entityType: 'user',
      entityId: id,
      before: { status: before.status, bannedReason: before.bannedReason },
      after: { status: 'active' },
      request: this.auditInfo(req),
    });
    return updated;
  }

  @Post(':id/revoke-sessions')
  @RequirePermissions('users.manage')
  @RateLimit({ name: 'admin.users.write', limit: 120, windowSec: 60, scope: 'user' })
  async revokeSessions(
    @Req() req: Request & { user?: { id: string; role: UserRole } },
    @Param('id') id: string,
  ) {
    const actor = this.actor(req);
    await this.users.getById(id); // 404 when unknown
    const revoked = await this.sessions.revokeAllForUser(
      id,
      actor.id ?? undefined,
      'admin_revoked',
    );

    this.audit.log({
      actor,
      action: 'users.sessions_revoked',
      entityType: 'user',
      entityId: id,
      after: { revoked },
      request: this.auditInfo(req),
    });
    return { revoked };
  }
}
