import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
import { DiskStorageDriver } from './drivers/disk.driver.js';
import { STORAGE_DRIVER } from './storage.driver.js';

/**
 * Storage infrastructure (B1.9): provides the STORAGE_DRIVER selected by the
 * `STORAGE_DRIVER` env (only `disk` today). Global like RedisModule/QueueModule
 * — the media module, the future profile/owner flows (avatars) and B2.7
 * business photos all inject it.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        switch (config.storageDriver) {
          case 'disk':
          default:
            return new DiskStorageDriver(config.storageRoot);
        }
      },
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
