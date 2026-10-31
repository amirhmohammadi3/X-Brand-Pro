import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Minimal structural type of a Zod schema (avoids importing zod here). */
interface Schema {
  safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown };
}

/**
 * `@ZodBody(schema)` — parses `req.body` through the schema.
 */
export const ZodBody = (_schema: Schema): ParameterDecorator =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.body;
  })();

/**
 * `@ZodQuery(schema)` — parses `req.query` through the schema.
 */
export const ZodQuery = (_schema: Schema): ParameterDecorator =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.query;
  })();

/**
 * `@ZodParam(schema)` — parses `req.params` through the schema.
 */
export const ZodParam = (_schema: Schema): ParameterDecorator =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.params;
  })();
