import type { Readable } from 'node:stream';

/**
 * Storage abstraction (B1.9). All binary blobs go through a driver; the
 * concrete implementation is selected by STORAGE_DRIVER (only `disk` today,
 * S3-compatible later). The API never touches the filesystem directly.
 */
export interface StorageDriver {
  /**
   * Store `data` under `key` atomically (readers never see partial content).
   * Returns the stored size in bytes.
   */
  put(
    key: string,
    data: Buffer | Readable,
    meta: { contentType: string },
  ): Promise<{ size: number }>;

  /**
   * Open `key` for reading. `range` selects a byte range (both inclusive,
   * `end` optional) for HTTP Range support; missing `end` means "to EOF".
   */
  getStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<{ stream: Readable; size: number; contentType?: string }>;

  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** DI token for the selected driver (StorageModule provides it from env). */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
