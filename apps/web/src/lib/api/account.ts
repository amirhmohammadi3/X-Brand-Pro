'use client';

/**
 * Account API hooks (F1.9). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B1.10/B1.8 contract schemas) and
 * TanStack Query via `useApiMutation`, so 4xx are never retried and server
 * field errors land in the standard `fieldErrors(error)` map.
 *
 * Mutations that return the updated `CurrentUser` seed `qk.auth.me()` so the
 * header user menu and every guarded surface reflect the change immediately.
 * The avatar upload is the one exception: it is multipart with progress, so it
 * uses a dedicated `XMLHttpRequest` uploader (`uploadMedia`) that mirrors
 * `apiFetch`'s envelope/error handling but reports progress and supports abort.
 */
import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  changePasswordBodySchema,
  changeUsernameBodySchema,
  deleteAccountBodySchema,
  errorEnvelopeSchema,
  oauthAccountsResponseSchema,
  sessionSchema,
  setAvatarBodySchema,
  updateProfileBodySchema,
  uploadMediaResponseSchema,
  ACCEPTED_IMAGE_MIMES,
  MEDIA_MAX_BYTES,
  type ChangePasswordBody,
  type ChangeUsernameBody,
  type CurrentUser,
  type DeleteAccountBody,
  type MediaKind,
  type OauthAccount,
  type SessionView,
  type SetAvatarBody,
  type UpdateProfileBody,
  type UploadMediaResponse,
} from '@app/contracts';
import { apiFetch } from './client';
import { ApiRequestError } from './errors';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';
import { env } from '../env';

/** Seed the shared auth cache with an updated user (mirrors F1.8 seedAuthCache). */
function seedUser(queryClient: QueryClient, user: CurrentUser): void {
  queryClient.setQueryData(qk.auth.me(), user);
}

// ---------------------------------------------------------------------------
// Profile (B1.10 endpoints mounted at /api/v1/users/me)
// ---------------------------------------------------------------------------

/** `PATCH /users/me` — display name, bio, locale. Returns the updated user. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useApiMutation<CurrentUser, UpdateProfileBody>(
    async (body) => {
      const result = await apiFetch('/users/me', z.custom<CurrentUser>(), {
        method: 'PATCH',
        body: updateProfileBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSuccess: (user) => {
        seedUser(queryClient, user);
      },
    },
  );
}

/** `PUT /users/me/avatar` — set the avatar to a previously uploaded media row. */
export function useSetAvatar() {
  const queryClient = useQueryClient();
  return useApiMutation<CurrentUser, SetAvatarBody>(
    async (body) => {
      const result = await apiFetch('/users/me/avatar', z.custom<CurrentUser>(), {
        method: 'PUT',
        body: setAvatarBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSuccess: (user) => {
        seedUser(queryClient, user);
      },
    },
  );
}

/** `DELETE /users/me/avatar` — clear the avatar. Returns the updated user. */
export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useApiMutation<CurrentUser, void>(
    async () => {
      const result = await apiFetch('/users/me/avatar', z.custom<CurrentUser>(), {
        method: 'DELETE',
      });
      return result.data;
    },
    {
      onSuccess: (user) => {
        seedUser(queryClient, user);
      },
    },
  );
}

/** `POST /users/me/username` — 30-day cooldown enforced server-side. */
export function useChangeUsername() {
  const queryClient = useQueryClient();
  return useApiMutation<CurrentUser, ChangeUsernameBody>(
    async (body) => {
      const result = await apiFetch('/users/me/username', z.custom<CurrentUser>(), {
        method: 'POST',
        body: changeUsernameBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSuccess: (user) => {
        seedUser(queryClient, user);
      },
    },
  );
}

/** `POST /users/me/password` — 204; `currentPassword` required only when the
 * account already has one. */
export function useChangePassword() {
  return useApiMutation<void, ChangePasswordBody>(async (body) => {
    await apiFetch('/users/me/password', z.void(), {
      method: 'POST',
      body: changePasswordBodySchema.parse(body),
    });
  });
}

/** `DELETE /users/me` — soft delete; 204. Caller clears the auth cache. */
export function useDeleteAccount() {
  return useApiMutation<void, DeleteAccountBody>(async (body) => {
    await apiFetch('/users/me', z.void(), {
      method: 'DELETE',
      body: deleteAccountBodySchema.parse(body),
    });
  });
}

// ---------------------------------------------------------------------------
// Media upload (B1.9 endpoint POST /media/upload — multipart)
// ---------------------------------------------------------------------------

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0–100, integer. */
  percent: number;
}

export interface UploadMediaOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Upload a single file as `kind` via `POST /media/upload` (multipart/form-data).
 *
 * Uses `XMLHttpRequest` (not `fetch`) so we can report upload progress and
 * support abort. The response envelope is parsed exactly like `apiFetch`:
 * success → validated against {@link uploadMediaResponseSchema}; failure →
 * `ApiRequestError` with the server's code/messageKey. Cookies travel via
 * `withCredentials` so the cookie-authenticated request is authorized.
 */
export function uploadMedia(
  file: File,
  kind: MediaKind,
  options: UploadMediaOptions = {},
): Promise<UploadMediaResponse> {
  return new Promise<UploadMediaResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')}/media/upload`;
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      reject(
        new ApiRequestError({
          status: 0,
          code: 'NETWORK_ERROR',
          message: 'Upload aborted',
        }),
      );
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      options.onProgress?.({ loaded: event.loaded, total: event.total, percent });
    };

    xhr.onload = () => {
      cleanup();
      const status = xhr.status;
      const body = xhr.response as
        | { ok: true; data: unknown }
        | {
            ok: false;
            error: {
              code: string;
              messageKey?: string;
              message?: string;
              details?: unknown;
              requestId?: string;
            };
          }
        | null;
      if (body !== null && typeof body === 'object' && body.ok === true && 'data' in body) {
        const parsed = uploadMediaResponseSchema.safeParse(body.data);
        if (parsed.success) {
          resolve(parsed.data);
          return;
        }
        reject(
          new ApiRequestError({
            status,
            code: 'INVALID_ENVELOPE',
            message: 'Upload response shape mismatch',
            details: parsed.error.issues,
          }),
        );
        return;
      }
      if (body !== null && typeof body === 'object' && body.ok === false && 'error' in body) {
        const parsed = errorEnvelopeSchema.safeParse(body);
        if (parsed.success) {
          const apiError = parsed.data.error;
          reject(
            new ApiRequestError({
              status,
              code: apiError.code,
              messageKey: apiError.messageKey,
              message: apiError.message,
              details: apiError.details,
              requestId: apiError.requestId,
            }),
          );
          return;
        }
      }
      reject(
        new ApiRequestError({
          status,
          code: 'INVALID_ENVELOPE',
          message: `Upload returned a non-envelope response (HTTP ${status})`,
        }),
      );
    };

    xhr.onerror = () => {
      cleanup();
      reject(
        new ApiRequestError({
          status: 0,
          code: 'NETWORK_ERROR',
          message: 'Upload network error',
        }),
      );
    };

    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    xhr.send(form);
  });
}

export interface UseUploadMediaResult {
  mutate: (file: File, kind: MediaKind) => Promise<UploadMediaResponse>;
  progress: UploadProgress | null;
  isPending: boolean;
  cancel: () => void;
}

/**
 * `useUploadMedia` — wraps {@link uploadMedia} with progress/isPending state
 * and an abort controller. The caller picks the file, this hook uploads it and
 * returns the media object (then feeds `mediaId` to {@link useSetAvatar}).
 */
export function useUploadMedia(): UseUploadMediaResult {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isPending, setIsPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const mutate = useCallback(async (file: File, kind: MediaKind) => {
    setIsPending(true);
    setProgress(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      return await uploadMedia(file, kind, {
        onProgress: setProgress,
        signal: controller.signal,
      });
    } finally {
      setIsPending(false);
      controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { mutate, progress, isPending, cancel };
}

// ---------------------------------------------------------------------------
// Sessions (B1.3 endpoints on /api/v1/auth)
// ---------------------------------------------------------------------------

/** `GET /auth/sessions` — every active session of the current user. */
export function useSessions(): {
  sessions: SessionView[] | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<SessionView[]>({
    queryKey: qk.auth.sessions(),
    queryFn: async () => {
      const result = await apiFetch('/auth/sessions', z.array(sessionSchema));
      return result.data;
    },
    staleTime: 30_000,
  });
  return { sessions: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `DELETE /auth/sessions/:id` — revoke one session (204). */
export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useApiMutation<void, string>(
    async (sessionId) => {
      await apiFetch(`/auth/sessions/${sessionId}`, z.void(), { method: 'DELETE' });
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.auth.sessions() });
      },
    },
  );
}

/** `POST /auth/logout-all` — revoke every session except the current one (204). */
export function useLogoutAll() {
  const queryClient = useQueryClient();
  return useApiMutation<void, void>(
    async () => {
      await apiFetch('/auth/logout-all', z.void(), { method: 'POST' });
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.auth.sessions() });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// OAuth accounts (B1.8 endpoints on /api/v1/auth)
// ---------------------------------------------------------------------------

/** `GET /auth/oauth/accounts` — linked external identities of the caller. */
export function useOAuthAccounts(): {
  accounts: OauthAccount[];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<{ accounts: OauthAccount[] }>({
    queryKey: qk.auth.oauth(),
    queryFn: async () => {
      const result = await apiFetch('/auth/oauth/accounts', oauthAccountsResponseSchema);
      return result.data;
    },
    staleTime: 60_000,
  });
  return {
    accounts: query.data?.accounts ?? [],
    isPending: query.isPending,
    error: query.error,
  };
}

/**
 * `DELETE /auth/oauth/accounts/:id` — unlink a provider. The server returns
 * `LAST_LOGIN_METHOD` (422) when unlinking would leave the account with no
 * way to sign in; the caller maps that to a friendly message.
 */
export function useUnlinkOAuth() {
  const queryClient = useQueryClient();
  return useApiMutation<void, string>(
    async (accountId) => {
      await apiFetch(`/auth/oauth/accounts/${accountId}`, z.void(), {
        method: 'DELETE',
      });
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.auth.oauth() });
      },
    },
  );
}

// Client-side guard shared by the avatar dropzone: reject early when the file
// type/size does not match the server limits (B1.9) so we never round-trip a
// doomed request. Mirrors ACCEPTED_IMAGE_MIMES / MEDIA_MAX_BYTES.avatar.
export const AVATAR_ACCEPTED_MIMES: readonly string[] = ACCEPTED_IMAGE_MIMES;
export const AVATAR_MAX_BYTES: number = MEDIA_MAX_BYTES.avatar;
