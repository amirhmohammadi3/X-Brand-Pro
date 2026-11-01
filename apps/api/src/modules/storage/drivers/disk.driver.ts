import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StorageDriver } from '../storage.driver.js';

/**
 * Local-disk driver (B1.9). Keys are relative addresses such as
 * `avatar/2026/11/<uuid>.webp`; every operation re-validates the key and
 * resolves it INSIDE the storage root (defense in depth — callers validate
 * too, but the driver is the last line).
 *
 * Writes are atomic: content lands in `<key>.<uuid>.tmp` in the same
 * directory and is renamed into place, so a reader either sees the old file,
 * the new file, or nothing — never a partial file.
 */
export class DiskStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    // Keys are joined onto an absolute root so relative STORAGE_ROOT values
    // behave identically regardless of the process cwd.
    this.root = path.resolve(root);
  }

  /** Validate a key and return its absolute path inside the root. */
  private resolve(key: string): string {
    const segments = key.split('/');
    if (
      key.length === 0 ||
      key.includes('\\') ||
      key.startsWith('/') ||
      segments.includes('..') ||
      segments.includes('.')
    ) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    const resolved = path.resolve(this.root, key);
    // `..` is already rejected, but keep the containment check as the final
    // guard against any future key rule change.
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    return resolved;
  }

  async put(
    key: string,
    data: Buffer | Readable,
    _meta: { contentType: string },
  ): Promise<{ size: number }> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      if (Buffer.isBuffer(data)) {
        await pipeline(Readable.from([data]), createWriteStream(tmp, { mode: 0o640 }));
      } else {
        await pipeline(data, createWriteStream(tmp, { mode: 0o640 }));
      }
      const { size } = await stat(tmp);
      // Atomic swap: rename(2) within the same directory.
      await rename(tmp, target);
      return { size };
    } finally {
      // If the rename did not happen (write/stat error), remove the temp file.
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  async getStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<{ stream: Readable; size: number; contentType?: string }> {
    const target = this.resolve(key);
    const { size } = await stat(target);
    const start = Math.max(0, range?.start ?? 0);
    const end = Math.min(size - 1, range?.end ?? size - 1);
    if (start > end || start >= size) {
      throw new Error(`Requested range out of bounds for key ${JSON.stringify(key)}`);
    }
    return { stream: createReadStream(target, { start, end }), size };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    // Validation happens outside the try: an INVALID key must reject, while
    // a merely MISSING file returns false.
    const target = this.resolve(key);
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }
}
