import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public_route';

/**
 * Marks a route as unauthenticated. The global auth guard (B1.2/B1.3) and the
 * interim deny-stub RolesGuard both honor it — a public route skips every
 * auth check.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
