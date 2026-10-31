import { z } from 'zod';
import { usernameSchema } from './primitives.js';

/**
 * Users & roles (B1.2). Wire shapes for the user model and RBAC. The
 * unauthenticated role `guest` is implicit (no user record) and never
 * appears in the database enum. Username rules are the shared
 * `usernameSchema` from primitives.ts (normalized: trimmed, lowercased).
 */

export const USER_ROLES = ['user', 'owner', 'moderator', 'admin', 'super_admin'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'blocked'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = (typeof USER_STATUSES)[number];

export { usernameSchema };
export type Username = z.infer<typeof usernameSchema>;

/** Admin view of a user — never includes password hash or secrets. */
export const adminUserViewSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  displayName: z.string().max(100).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AdminUserView = z.infer<typeof adminUserViewSchema>;

/** Body for the admin role-change endpoint (endpoint itself arrives in B1.14). */
export const changeRoleBodySchema = z
  .object({
    role: userRoleSchema,
  })
  .strict();
export type ChangeRoleBody = z.infer<typeof changeRoleBodySchema>;

/** Body for the admin block/unblock endpoint (endpoint itself arrives in B1.14). */
export const changeStatusBodySchema = z
  .object({
    status: userStatusSchema,
  })
  .strict();
export type ChangeStatusBody = z.infer<typeof changeStatusBodySchema>;
