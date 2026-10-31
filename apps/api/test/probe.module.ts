import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../src/common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe.js';

const echoBodySchema = z
  .object({
    name: z.string().min(2),
    age: z.coerce.number().int().min(0).max(150),
  })
  .strict();

/**
 * Test-only probe controller (registered ONLY in the test module composition)
 * used to verify the global filter/pipe behaviour end-to-end:
 *  - POST /probe/echo with an invalid body → 400 VALIDATION_FAILED + details
 *  - GET  /probe/boom → generic Error → 500 INTERNAL_ERROR without leaking
 */
@Controller('probe')
export class ProbeController {
  @Public() // test-only routes must bypass the global JwtAuthGuard (B1.3)
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoBodySchema)) body: unknown): unknown {
    return body;
  }

  @Public()
  @Get('boom')
  boom(): never {
    throw new Error('super secret internals that must never leak');
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
