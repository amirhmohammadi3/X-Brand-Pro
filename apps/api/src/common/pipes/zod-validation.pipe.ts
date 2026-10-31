import {
  type ArgumentMetadata,
  type PipeTransform,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Validation issue shape shared with the exceptions filter.
 */
export interface ZodIssueDto {
  path: string;
  message: string;
}

/** Structural view of a Zod safeParse result. */
interface SafeParseFailure {
  success: false;
  error: { issues: Array<{ path: PropertyKey[]; message: string }> };
}
interface SafeParseSuccess {
  success: true;
  data: unknown;
}
export type SafeParseResult = SafeParseFailure | SafeParseSuccess;

/** Structural type of a Zod schema — no zod import needed here. */
interface SchemaLike {
  safeParse: (v: unknown) => SafeParseResult;
}

/**
 * Turns a ZodError into a 400 VALIDATION_FAILED HttpException whose `details`
 * is an array of `{ path, message }` — exactly what AllExceptionsFilter
 * forwards to the client.
 */
export function zodValidationError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): HttpException {
  const details: ZodIssueDto[] = error.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
  return new HttpException(
    { code: 'VALIDATION_FAILED', message: 'Validation failed', details },
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Global-friendly pipe: `new ZodValidationPipe(schema)`. Parses and coerces
 * the incoming value with the schema; strict schemas (`.strict()`) reject
 * unknown keys per AGENTS.md §9.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: SchemaLike) {}

  transform(value: unknown, _meta: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) throw zodValidationError(result.error);
    return result.data;
  }
}
