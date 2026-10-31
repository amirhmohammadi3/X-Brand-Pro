import { SetMetadata } from '@nestjs/common';

/**
 * Declares which roles may call a route: `@Roles('admin', 'super_admin')`.
 * Consumed by the global RolesGuard. Role names are the six from AGENTS.md
 * section 1 (guest, user, owner, moderator, admin, super_admin).
 */
export const ROLES_KEY = 'required_roles';

export type Role = 'guest' | 'user' | 'owner' | 'moderator' | 'admin' | 'super_admin';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
