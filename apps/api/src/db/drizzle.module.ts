import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { createPool, DrizzleClient, DRIZZLE_POOL } from './drizzle.client.js';

/**
 * Global database module. The pool is built from the validated
 * `AppConfig.databaseUrl` at DI time (not import time), so changing env in
 * tests before compiling the module is enough. pg pools connect lazily; no
 * socket is opened until the first query.
 */
export const drizzlePoolProvider = {
  provide: DRIZZLE_POOL,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => createPool(config.databaseUrl),
};

@Global()
@Module({
  providers: [drizzlePoolProvider, DrizzleClient],
  exports: [DRIZZLE_POOL, DrizzleClient],
})
export class DrizzleModule {}
