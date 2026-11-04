import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authResultSchema,
  currentUserSchema,
  forgotPasswordResultSchema,
  otpRequestResultSchema,
  registerBodySchema,
  loginBodySchema,
  otpRequestBodySchema,
  otpVerifyBodySchema,
  verifyRequestBodySchema,
  verifyConfirmBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  type AuthResult,
  type CurrentUser,
  type ForgotPasswordBody,
  type LoginBody,
  type OtpRequestBody,
  type OtpRequestResult,
  type OtpVerifyBody,
  type RegisterBody,
  type ResetPasswordBody,
  type VerifyRequestBody,
  type VerifyConfirmBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/**
 * Auth API hooks (F1.8). Every call goes through the shared `apiFetch`
 * (envelope-validated with the B1.3/B1.7 contract schemas) and TanStack
 * Query via `useApiMutation`, so 4xx are never retried and server field
 * errors land in the standard `fieldErrors(error)` map.
 *
 * Success payloads for register/login/otp-verify are `AuthResult` (cookies
 * are set by the API as httpOnly `Set-Cookie`; no token ever lives in JS).
 * Callers refresh the auth cache by seeding `qk.auth.me()` with
 * `result.user` and invalidating it.
 */

/** `POST /auth/login` — identifier (username | email | phone) + password. */
export function useLogin() {
  return useApiMutation<AuthResult, LoginBody>(async (body) => {
    const result = await apiFetch('/auth/login', authResultSchema, {
      method: 'POST',
      body: loginBodySchema.parse(body),
    });
    return result.data;
  });
}

/** `POST /auth/register` — username + password (+ optional profile/contact). */
export function useRegister() {
  return useApiMutation<AuthResult, RegisterBody>(async (body) => {
    const result = await apiFetch('/auth/register', authResultSchema, {
      method: 'POST',
      body: registerBodySchema.parse(body),
    });
    return result.data;
  });
}

/** `POST /auth/otp/request` — login code via SMS or email. */
export function useRequestOtp() {
  return useApiMutation<OtpRequestResult, OtpRequestBody>(async (body) => {
    const result = await apiFetch('/auth/otp/request', otpRequestResultSchema, {
      method: 'POST',
      body: otpRequestBodySchema.parse(body),
    });
    return result.data;
  });
}

/** `POST /auth/otp/verify` — proves ownership and logs in (or registers). */
export function useVerifyOtp() {
  return useApiMutation<AuthResult, OtpVerifyBody>(async (body) => {
    const result = await apiFetch('/auth/otp/verify', authResultSchema, {
      method: 'POST',
      body: otpVerifyBodySchema.parse(body),
    });
    return result.data;
  });
}

/** `POST /auth/password/forgot` — issues a reset code; response is opaque. */
export function useForgotPassword() {
  return useApiMutation<{ ok: true }, ForgotPasswordBody>(async (body) => {
    const result = await apiFetch('/auth/password/forgot', forgotPasswordResultSchema, {
      method: 'POST',
      body: forgotPasswordBodySchema.parse(body),
    });
    return result.data;
  });
}

/** `POST /auth/password/reset` — code + new password; 204 on success. */
export function useResetPassword() {
  return useApiMutation<void, ResetPasswordBody>(async (body) => {
    await apiFetch('/auth/password/reset', z.void(), {
      method: 'POST',
      body: resetPasswordBodySchema.parse(body),
    });
  });
}

/**
 * `POST /auth/logout` — revokes the current session server-side (204) and
 * clears the auth cache in `onSettled` even when the request fails: the
 * cookies are the source of truth and a failed call must never trap the
 * visitor in a logged-in UI.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  return useApiMutation<void, void>(
    async () => {
      await apiFetch('/auth/logout', z.void(), { method: 'POST' });
    },
    {
      onSettled: () => {
        queryClient.setQueryData(qk.auth.me(), null);
        void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
      },
    },
  );
}

/** `POST /auth/verify/request` (authenticated) — code for a pending identifier. */
export function useVerifyRequest() {
  return useApiMutation<OtpRequestResult, VerifyRequestBody>(async (body) => {
    const result = await apiFetch('/auth/verify/request', otpRequestResultSchema, {
      method: 'POST',
      body: verifyRequestBodySchema.parse(body),
    });
    return result.data;
  });
}

/** `POST /auth/verify/confirm` (authenticated) — returns the updated user. */
export function useVerifyConfirm() {
  return useApiMutation<CurrentUser, VerifyConfirmBody>(async (body) => {
    const result = await apiFetch('/auth/verify/confirm', currentUserSchema, {
      method: 'POST',
      body: verifyConfirmBodySchema.parse(body),
    });
    return result.data;
  });
}

const googleSettingsSchema = z.object({ 'oauth.google.enabled': z.boolean() });

/**
 * OAuth availability for the login screen. There is no dedicated providers
 * endpoint in the API — B1.8 registered `oauth.google.enabled` as a PUBLIC
 * setting, so it is read from `GET /settings/public` (flat key/value blob).
 * Anything missing/invalid counts as disabled (the Google start route 404s
 * until an admin enables it anyway).
 */
export function useOAuthProviders(): { googleEnabled: boolean; isPending: boolean } {
  const query = useQuery({
    queryKey: qk.settings.public(),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const result = await apiFetch('/settings/public', z.record(z.unknown()));
      const parsed = googleSettingsSchema.safeParse(result.data);
      return parsed.success && parsed.data['oauth.google.enabled'] === true;
    },
  });
  return { googleEnabled: query.data === true, isPending: query.isPending };
}
