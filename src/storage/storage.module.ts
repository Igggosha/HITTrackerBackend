import { Module } from '@nestjs/common';
import {
  isStorageConfigured,
  readStorageConfig,
  type StorageConfig,
} from './storage.config';
import { StorageService } from './storage.service';
import { STORAGE_CONFIG } from './storage.tokens';

/**
 * Object storage wiring.
 *
 * The configuration is resolved once at boot: `validateEnvironment` has already
 * rejected a broken one, so reaching here means the settings are either valid
 * or deliberately absent.
 */
@Module({
  providers: [
    {
      provide: STORAGE_CONFIG,
      useFactory: (): StorageConfig | null =>
        isStorageConfigured(process.env)
          ? readStorageConfig(process.env)
          : null,
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
