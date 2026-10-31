import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Declares the permissions a route needs: `@RequirePermissions('settings.manage')`.
 * Consumed by the global RolesGuard (B1.5): the authenticated user's role must
 * hold EVERY listed permission (see ROLE_PERMISSIONS in users.service.ts).
 * Routes with both @Roles and @RequirePermissions must satisfy both.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
