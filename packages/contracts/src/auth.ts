import { z } from 'zod';
import {
  emailSchema,
  iranMobileSchema,
  localeCodeSchema,
  passwordSchema,
  usernameSchema,
} from './primitives.js';
import { otpChannelSchema, type OtpChannel } from './otp.js';
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
  // B1.10: profile fields.
  bio: z.string().max(300).nullable(),
  locale: localeCodeSchema.nullable(),
  /** Public URL of the avatar (thumb when present, else the main image). */
  avatarUrl: z.string().nullable(),
  /** True when the account can log in with a password (drives the UI form). */
  hasPassword: z.boolean(),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
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

// ---------------------------------------------------------------------------
// OTP-based auth flows (B1.7)
// ---------------------------------------------------------------------------
// otpChannelSchema / OtpChannel / otpRequestResultSchema / OtpPurpose live in
// ./otp.js (B1.4 anticipated these flows) and are re-exported via index.ts.

/** `target` must be a valid Iranian mobile for sms and an email for email. */
const channelTargetRefinement = (
  v: { channel: OtpChannel; target: string },
  ctx: z.RefinementCtx,
) => {
  if (v.channel === 'sms' && !iranMobileSchema.safeParse(v.target).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'must be an Iranian mobile number',
    });
  }
  if (v.channel === 'email' && !emailSchema.safeParse(v.target).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'must be a valid email address',
    });
  }
};

/** Body of POST /auth/otp/request — passwordless login code. */
export const otpRequestBodySchema = z
  .object({
    channel: otpChannelSchema,
    target: z.string().min(3).max(254),
  })
  .strict()
  .superRefine(channelTargetRefinement);
export type OtpRequestBody = z.infer<typeof otpRequestBodySchema>;

/** Body of POST /auth/otp/verify — proves ownership and logs in / registers. */
export const otpVerifyBodySchema = z
  .object({
    channel: otpChannelSchema,
    target: z.string().min(3).max(254),
    code: z.string().min(4).max(10),
  })
  .strict()
  .superRefine(channelTargetRefinement);
export type OtpVerifyBody = z.infer<typeof otpVerifyBodySchema>;

/** Body of POST /auth/verify/request (authenticated) — new or pending identifier. */
export const verifyRequestBodySchema = z
  .object({
    channel: otpChannelSchema,
    target: z.string().min(3).max(254),
  })
  .strict()
  .superRefine(channelTargetRefinement);
export type VerifyRequestBody = z.infer<typeof verifyRequestBodySchema>;

/** Body of POST /auth/verify/confirm (authenticated). */
export const verifyConfirmBodySchema = z
  .object({
    channel: otpChannelSchema,
    target: z.string().min(3).max(254),
    code: z.string().min(4).max(10),
  })
  .strict()
  .superRefine(channelTargetRefinement);
export type VerifyConfirmBody = z.infer<typeof verifyConfirmBodySchema>;

/** Body of POST /auth/password/forgot — username, email or phone. */
export const forgotPasswordBodySchema = z
  .object({
    identifier: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(3).max(254)),
  })
  .strict();
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

/** Response of POST /auth/password/forgot — deliberately opaque (anti-enumeration). */
export const forgotPasswordResultSchema = z.object({ ok: z.literal(true) }).strict();
export type ForgotPasswordResult = z.infer<typeof forgotPasswordResultSchema>;

/** Body of POST /auth/password/reset. */
export const resetPasswordBodySchema = z
  .object({
    identifier: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(3).max(254)),
    code: z.string().min(4).max(10),
    newPassword: passwordSchema,
  })
  .strict();
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

/**
 * Response of every code request (otp/request, verify/request): identical
 * whether or not the target belongs to an account (anti-enumeration, B1.7).
 * The shape itself is `otpRequestResultSchema` from ./otp.js (B1.4).
 */

// --- Linked OAuth accounts (B1.8) ---

/** One linked external identity, as returned to its owner (B1.8). */
export const oauthAccountSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(['google']),
    /** Email reported by the provider at link time; may be null. */
    email: z.string().email().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type OauthAccount = z.infer<typeof oauthAccountSchema>;

export const oauthAccountsResponseSchema = z
  .object({
    accounts: z.array(oauthAccountSchema),
  })
  .strict();
export type OauthAccountsResponse = z.infer<typeof oauthAccountsResponseSchema>;
