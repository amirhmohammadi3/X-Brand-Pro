import { z } from 'zod';
import {
  emailSchema,
  iranMobileSchema,
  localeCodeSchema,
  passwordSchema,
  usernameSchema,
} from './primitives.js';
import { userRoleSchema, userStatusSchema } from './users.js';

/**
 * Authentication wire shapes (B1.3). Register/login bodies are strict —
 * unknown keys are rejected at the edge (AGENTS.md section 9). All
 * normalization (digits, case, E.164) happens inside the shared primitive
 * schemas so api and web validate identically.
 */

export const registerBodySchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    fullName: z.string().min(1).max(100).optional(),
    email: emailSchema.optional(),
    phone: iranMobileSchema.optional(),
    locale: localeCodeSchema.optional(),
  })
  .strict();
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z
  .object({
    identifier: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(3).max(254)),
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginBody = z.infer<typeof loginBodySchema>;

/** Body for POST /auth/refresh from non-browser clients (no cookie jar). */
export const refreshBodySchema = z
  .object({
    refreshToken: z.string().min(1).max(512),
  })
  .strict();
export type RefreshBody = z.infer<typeof refreshBodySchema>;

/** The signed-in user as the client sees it — no password hash, no secrets. */
export const currentUserSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  displayName: z.string().max(100).nullable(),
  locale: localeCodeSchema.nullable(),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** One server-side session as listed by GET /auth/sessions. */
export const sessionSchema = z.object({
  id: z.string().uuid(),
  userAgent: z.string().nullable(),
  /** IP with the last octet masked for display (privacy). */
  ip: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }),
  current: z.boolean(),
});
export type SessionView = z.infer<typeof sessionSchema>;

/**
 * Result of register/login/refresh: the current user plus when the access
 * token expires. Tokens travel in httpOnly cookies; `refreshToken` is set
 * ONLY when the caller presented the refresh token in the body (non-browser
 * clients keep the chain without a cookie jar — DECISIONS 2026-11-01 B1.3).
 */
export const authResultSchema = z.object({
  user: currentUserSchema,
  accessExpiresAt: z.string().datetime({ offset: true }),
  refreshToken: z.string().optional(),
});
export type AuthResult = z.infer<typeof authResultSchema>;
