import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './errors.js';

/** Payload of a failed API call. */
export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  messageKey: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
  requestId: z.string().min(1),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Builds the success envelope schema `{ ok: true, data, meta? }` for a given
 * data schema and optional meta schema.
 */
export function okEnvelope<D extends z.ZodTypeAny, M extends z.ZodTypeAny | undefined = undefined>(
  dataSchema: D,
  metaSchema?: M,
) {
  const inner = z.object({ ok: z.literal(true), data: dataSchema });
  if (metaSchema) {
    return z.object({ ok: z.literal(true), data: dataSchema, meta: metaSchema });
  }
  return inner;
}

/** The failure envelope `{ ok: false, error: {...} }`. */
export const errorEnvelopeSchema = z.object({ ok: z.literal(false), error: apiErrorSchema });

/** Union of every possible API response shape. */
export const apiEnvelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  errorEnvelopeSchema,
]);

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = z.infer<typeof errorEnvelopeSchema>;
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Narrow a parsed envelope to a failure. */
export function isApiFailure<T>(x: ApiEnvelope<T>): x is ApiFailure {
  return x.ok === false;
}

/** Convenience: build a failure envelope value. */
export function failureEnvelope(params: {
  code: ErrorCode;
  messageKey: string;
  message: string;
  details?: unknown;
  requestId: string;
}): ApiFailure {
  return {
    ok: false,
    error: {
      code: params.code,
      messageKey: params.messageKey,
      message: params.message,
      ...(params.details !== undefined ? { details: params.details } : {}),
      requestId: params.requestId,
    },
  };
}
