import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { roleSatisfies } from '../../modules/users/users.service.js';
import type { UserRole } from '@app/contracts';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/** Shape the future JWT/session guard (B1.3) attaches to authenticated requests. */
export interface AuthenticatedRequest {
  user?: { id: string; role: UserRole; status: string };
}

/**
 * RBAC guard (B1.2 — final metadata contract):
 *  - @Public() routes pass without identity.
 *  - @Roles('a','b') routes require an authenticated, ACTIVE user whose role
 *    satisfies ANY of the listed roles; super_admin always passes.
 *  - Routes with neither decorator pass (they must be genuinely public or
 *    ownership-checked in the service — AGENTS.md 6/9).
 *
 * Until B1.3 attaches `req.user`, no request carries an identity, so every
 * @Roles route is denied (403) — the closed-by-default behavior from B1.1
 * becomes simply "no identity yet" instead of a special case.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<readonly string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      throw new HttpException(
        { code: 'UNAUTHENTICATED' as const, message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED, // 401 — Nest's HttpStatus spells it UNAUTHORIZED
      );
    }
    if (user.status !== 'active') {
      throw new HttpException(
        { code: 'FORBIDDEN' as const, message: 'Account is blocked' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (!roleSatisfies(user.role, roles)) {
      throw new HttpException(
        { code: 'FORBIDDEN' as const, message: 'Insufficient role' },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
