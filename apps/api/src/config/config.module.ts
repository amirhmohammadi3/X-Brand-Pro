import { Global, Module } from '@nestjs/common';
import { buildAppConfig, loadEnv, type AppConfig } from './env.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Global config module providing the typed AppConfig built from the
 * validated environment. Env parsing is DEFERRED to DI instantiation time
 * (app.init / Test.compile), so tests and CI can set process.env after
 * imports and before creating the app. main.ts gets a fail-fast boot because
 * configureApp() calls app.get(APP_CONFIG) before listen().
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(source?: Record<string, string | undefined>) {
    return {
      module: ConfigModule,
      global: true,
      providers: [
        {
          provide: APP_CONFIG,
          useFactory: (): AppConfig => buildAppConfig(loadEnv(source)),
        },
      ],
      exports: [APP_CONFIG],
    };
  }
}
