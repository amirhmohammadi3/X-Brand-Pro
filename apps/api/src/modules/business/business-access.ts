import { ForbiddenException, type UnauthorizedException } from '@nestjs/common';
import { roleHasPermissions } from '../users/users.service.js';
import type { BusinessStatus } from '@app/contracts';

/**
 * Business access control (B2.5). The single authorization helper reused by
 * the hours endpoints here and by later business prompts (B2.6 CRUD, B2.7
 * photos, B2.8 menu, B2.9 claims): a user may manage a business when they hold
 * the `businesses.manage` permission (admin / super_admin), OR when they are
 * the business's owner (role `owner`) and the business is in an owner-editable
 * status (`draft`, `pending`, `active`, `suspended`). Suspended businesses stay
 * editable by their owner (visibility is unaffected by the edit lock).
 *
 * `assertCanManageBusiness` throws `ForbiddenException` when the caller is not
 * allowed; `canManageBusiness` returns a boolean for the cases that need a
 * branch (e.g. the public/owner GET split). Both expect an already-authenticated
 * user — the global JwtAuthGuard guarantees `req.user` on non-@Public routes.
 */

/** The minimal authenticated user shape set by JwtAuthGuard on `req.user`. */
export interface BusinessActor {
  id: string;
  role: string;
}

/** The minimal business shape the access check needs. */
export interface ManagedBusiness {
  ownerId: string | null;
  status: BusinessStatus;
}

/** Statuses in which the owner may still edit their business. */
export const OWNER_EDITABLE_STATUSES: readonly BusinessStatus[] = [
  'draft',
  'pending',
  'active',
  'suspended',
];

export function canManageBusiness(user: BusinessActor, business: ManagedBusiness): boolean {
  if (roleHasPermissions(user.role as never, ['businesses.manage'])) return true;
  if (business.ownerId === user.id && user.role === 'owner') {
    return OWNER_EDITABLE_STATUSES.includes(business.status);
  }
  return false;
}

/**
 * Throw `ForbiddenException` unless `canManageBusiness` allows the action.
 * Pass an `UnauthenticatedError` (the `UnauthorizedException` import is kept as
 * a type-only marker for callers that want to distinguish 401 vs 403 upstream).
 */
export function assertCanManageBusiness(
  user: BusinessActor | undefined,
  business: ManagedBusiness,
): void | UnauthorizedException {
  if (!user) {
    throw new ForbiddenException();
  }
  if (!canManageBusiness(user, business)) {
    throw new ForbiddenException();
  }
}

/**
 * Whether a caller may READ a non-active business's hours (B2.5 GET). Active
 * businesses are public; non-active ones are visible to their owner (any
 * status) or to a `businesses.manage` holder. Returns false for anonymous
 * callers so the controller answers 404 (never 403, to avoid leaking existence
 * — the same rule B2.6 adopts for the business detail).
 */
export function canViewBusinessHours(
  user: BusinessActor | undefined,
  business: ManagedBusiness,
): boolean {
  if (business.status === 'active') return true;
  if (!user) return false;
  if (roleHasPermissions(user.role as never, ['businesses.manage'])) return true;
  return business.ownerId === user.id;
}
