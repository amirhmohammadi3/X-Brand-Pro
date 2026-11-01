import { z } from 'zod';
import { localeCodeSchema, passwordSchema, usernameSchema, uuidSchema } from './primitives.js';

/**
 * Users & roles (B1.2). Wire shapes for the user model and RBAC. The
 * unauthenticated role `guest` is implicit (no user record) and never
 * appears in the database enum. Username rules are the shared
 * `usernameSchema` from primitives.ts (normalized: trimmed, lowercased).
 */

export const USER_ROLES = ['user', 'owner', 'moderator', 'admin', 'super_admin'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = (typeof USER_ROLES)[number];

/** `deleted` = soft-deleted (B1.10); deleted users never authenticate. */
export const USER_STATUSES = ['active', 'blocked', 'deleted'] as const;
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

/* ------------------------------------------------------------------ */
/* Profile API (B1.10) — /api/v1/users/me                              */
/* ------------------------------------------------------------------ */

/** Body for PATCH /users/me. `bio` may be cleared with an explicit null. */
export const updateProfileBodySchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    bio: z.string().max(300).nullable().optional(),
    locale: localeCodeSchema.optional(),
  })
  .strict();
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

/** Body for PUT /users/me/avatar — a previously uploaded avatar-kind media row. */
export const setAvatarBodySchema = z
  .object({
    mediaId: uuidSchema,
  })
  .strict();
export type SetAvatarBody = z.infer<typeof setAvatarBodySchema>;

/** Body for POST /users/me/username (30-day cooldown enforced server-side). */
export const changeUsernameBodySchema = z
  .object({
    username: usernameSchema,
  })
  .strict();
export type ChangeUsernameBody = z.infer<typeof changeUsernameBodySchema>;

/**
 * Body for POST /users/me/password. `currentPassword` is required when the
 * account already has a password; OTP/Google accounts set their first
 * password without one (the endpoint then requires a verified identifier).
 */
export const changePasswordBodySchema = z
  .object({
    currentPassword: passwordSchema.optional(),
    newPassword: passwordSchema,
  })
  .strict();
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

/** Body for DELETE /users/me — soft delete with explicit confirmation. */
export const deleteAccountBodySchema = z
  .object({
    password: passwordSchema.optional(),
    confirm: z.literal('DELETE'),
  })
  .strict();
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;
