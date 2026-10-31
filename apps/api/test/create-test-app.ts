import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';

/**
 * createTestApp() — builds the Nest app with the same global
 * pipes/filters/interceptors/middleware as main.ts by sharing configureApp().
 * `extraImports` lets test-only probe modules register additional controllers.
 * Tests must set the required env vars on process.env BEFORE calling this
 * (Q0.1 moves that into test/global-setup.ts).
 */
export async function createTestApp(extraImports: Type<unknown>[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
  }).compile();

  const app = moduleRef.createNestApplication() as NestExpressApplication;
  return configureApp(app);
}
