import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
// Reflector is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * INTERIM guard (B1.1): enforces the metadata contract before the real auth
 * system exists.
 *
 * - @Public() routes pass.
 * - @Roles() routes are DENIED with 403 until B1.2 lands users/roles and
 *   B1.3 lands sessions — there is no identity to check yet, and an
 *   unprotected admin API would be a hole, not a placeholder.
 * - Routes with neither decorator pass (phase-0 routes like /health; every
 *   future protected route MUST carry one of the two, per AGENTS.md 6).
 *
 * B1.2 replaces the deny branch with real role checks against
 * `req.user.role` (set by the JWT guard) — the metadata contract stays.
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

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    // No authentication exists yet (B1.2/B1.3): deny every role-protected
    // route rather than exposing it.
    throw new HttpException(
      { code: 'FORBIDDEN' as const, message: 'Authentication is not available yet' },
      HttpStatus.FORBIDDEN,
    );
  }
}
