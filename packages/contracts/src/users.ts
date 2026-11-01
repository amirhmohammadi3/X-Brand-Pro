import { z } from 'zod';
import {
  isoDateSchema,
  localeCodeSchema,
  passwordSchema,
  usernameSchema,
  uuidSchema,
} from './primitives.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';

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

// ---------------------------------------------------------------------------
// Admin users API (B1.14)
// ---------------------------------------------------------------------------

export const ADMIN_USER_SORTS = ['createdAt', 'lastLoginAt', 'username'] as const;
export const adminUserSortSchema = z.enum(ADMIN_USER_SORTS);
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

/** Admin list query: search + filters + page + explicit stable sort. */
export const adminUserListQuerySchema = pageQuerySchema
  .extend({
    q: z.string().min(1).max(200).optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
    sort: adminUserSortSchema.default('createdAt'),
    /** `asc` | `desc` (default `desc` for dates, `asc` for username). */
    direction: z.enum(['asc', 'desc']).optional(),
  })
  .strict();
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

/**
 * Full admin view of a user — the adminUserView (B1.2) plus everything an
 * administrator may act on. Never includes secrets (password hash, tokens).
 */
export const adminUserSchema = adminUserViewSchema
  .extend({
    displayName: z.string().max(100).nullable(),
    bio: z.string().max(300).nullable(),
    locale: z.string().nullable(),
    emailVerified: z.boolean(),
    phoneVerified: z.boolean(),
    bannedReason: z.string().max(500).nullable(),
    bannedUntil: z.string().datetime({ offset: true }).nullable(),
    lastLoginAt: z.string().datetime({ offset: true }).nullable(),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
    sessionsCount: z.number().int().min(0),
  })
  .strict();
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserDetailSchema = adminUserSchema;
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserSchema),
  meta: pageMetaSchema,
});
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

/** `changeRoleBodySchema` (B1.2) is the PATCH /:id/role body. */

/** Body for POST /admin/users/:id/ban. */
export const banBodySchema = z
  .object({
    reason: z.string().min(3).max(500),
    /** Optional expiry; omit = indefinite ban (until manually unbanned). */
    until: isoDateSchema.optional(),
  })
  .strict();
export type BanBody = z.infer<typeof banBodySchema>;
