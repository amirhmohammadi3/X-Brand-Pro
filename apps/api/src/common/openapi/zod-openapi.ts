import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Minimal custom adapter that publishes a Zod schema to OpenAPI as a
 * `#/components/schemas/<name>` reference.
 *
 * Why not nestjs-zod (see DECISIONS 2026-10-31 B0.1): nestjs-zod 5.5.0 peers
 * on @nestjs/common ^10 || ^11 (Nest 12 not supported yet) and its zod peer
 * (^3.25 || ^4) does not match the pinned zod 3.24.1 in @app/contracts.
 * This tiny adapter covers what we need; revisit when nestjs-zod ships
 * Nest-12 support.
 */
export function zodOkResponse(
  name: string,
  _schema: unknown,
  description?: string,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(),
    ApiOkResponse({
      description: description ?? `${name} success envelope`,
      schema: {
        allOf: [
          {
            type: 'object',
            properties: {
              ok: { type: 'boolean', enum: [true] },
              data: { $ref: getSchemaPath(name) },
            },
          },
        ],
      },
    }),
  );
}
