import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { isApiRequestError, type ApiRequestError } from './errors';

/**
 * Server field-error shape (F0.2 contract). The API's `VALIDATION_FAILED`
 * envelope carries `details: { fields: Record<fieldName, FieldIssue[]> }`,
 * where each `FieldIssue` is either a plain i18n message key string
 * (`validation.required`) or `{ key: string; params?: Record<string, unknown> }`
 * for parametric messages (`validation.min` with `{ min: 8 }`).
 *
 * `useApiMutation().fieldErrors(error)` extracts this map so form hooks
 * (`useZodForm.setServerErrors`) can stamp the errors onto the right fields.
 */
export type FieldIssue = string | { key: string; params?: Record<string, unknown> };

export interface ServerFieldErrors {
  fields?: Record<string, FieldIssue[]>;
}

/**
 * `useApiMutation` (F0.2) — the single hook every mutation in the app uses.
 *
 * It wraps TanStack Query's `useMutation` with three things specific to this
 * platform:
 *  1. `isClientError(error)` / `isRateLimited(error)` already derived from
 *     `ApiRequestError`, so callers don't re-import the error class.
 *  2. `fieldErrors(error)` — extracts the server's per-field validation map
 *     from `ApiError.details` (the `VALIDATION_FAILED` envelope). Returns
 *     `{}` when the error isn't a field-error envelope so form code can call
 *     it unconditionally.
 *  3. Sensible retry defaults: never retry 4xx (idempotency-safe + avoids
 *     hammering the rate limiter), retry 5xx once.
 */
export function useApiMutation<
  TData = unknown,
  TVariables = void,
  TError = ApiRequestError,
  TContext = unknown,
>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> & {
  isClientError: (error: unknown) => boolean;
  isRateLimited: (error: unknown) => boolean;
  fieldErrors: (error: unknown) => Record<string, FieldIssue[]>;
} {
  const mutation = useMutation<TData, TError, TVariables, TContext>({
    mutationFn,
    retry: (failureCount, error) => {
      // Never retry client errors (4xx) — they will not succeed on repeat.
      if (isApiRequestError(error) && error.isClientError) return false;
      // One retry for transient server/network failures.
      return failureCount < 1;
    },
    ...options,
  });

  const isClientError = (error: unknown): boolean =>
    isApiRequestError(error) && error.isClientError;

  const isRateLimited = (error: unknown): boolean =>
    isApiRequestError(error) && error.isRateLimited;

  const fieldErrors = (error: unknown): Record<string, FieldIssue[]> => {
    if (!isApiRequestError(error)) return {};
    const details = error.details as ServerFieldErrors | undefined;
    if (!details || typeof details !== 'object') return {};
    const fields = details.fields;
    if (!fields || typeof fields !== 'object') return {};
    return fields as Record<string, FieldIssue[]>;
  };

  return Object.assign(mutation, { isClientError, isRateLimited, fieldErrors });
}
