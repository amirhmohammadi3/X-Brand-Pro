import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DiskStorageDriver } from '../src/modules/storage/drivers/disk.driver.js';

/**
 * Disk driver unit tests (B1.9): key validation, atomic writes, round-trips,
 * range reads. Pure filesystem — no services needed.
 */
describe('DiskStorageDriver', () => {
  let root: string;
  let driver: DiskStorageDriver;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'xbrand-storage-'));
    driver = new DiskStorageDriver(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('key validation (path traversal protection)', () => {
    it.each([
      '../x',
      'a/../b',
      'a/../../etc/passwd',
      '/etc/passwd',
      'a\\b',
      '..\\windows\\system32',
      '',
      './x',
      'a/./b',
    ])('rejects unsafe key %j', async (key) => {
      await expect(
        driver.put(key, Buffer.from('x'), { contentType: 'text/plain' }),
      ).rejects.toThrow(/Invalid storage key/);
      await expect(driver.getStream(key)).rejects.toThrow(/Invalid storage key/);
      await expect(driver.delete(key)).rejects.toThrow(/Invalid storage key/);
      await expect(driver.exists(key)).rejects.toThrow(/Invalid storage key/);
    });
  });

  it('round-trips a buffer and creates directories on demand', async () => {
    const data = Buffer.from('hello media world');
    const { size } = await driver.put('avatar/2026/11/abc.webp', data, {
      contentType: 'image/webp',
    });
    expect(size).toBe(data.length);

    const { stream, size: readSize } = await driver.getStream('avatar/2026/11/abc.webp');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(data);
    expect(readSize).toBe(size);
  });

  it('writes atomically: temp files never linger and readers see whole content', async () => {
    const data = Buffer.alloc(64 * 1024, 7);
    await driver.put('business_photo/2026/11/atomic.webp', data, { contentType: 'image/webp' });
    // After a successful put, no *.tmp remains anywhere in the tree.
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...(await walk(full)));
        else files.push(e.name);
      }
      return files;
    };
    const files = await walk(root);
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);
  });

  it('streams a readable source without loading it all in memory', async () => {
    const data = Buffer.from('streamed-content');
    const { size } = await driver.put('menu_photo/2026/11/stream.webp', Readable.from([data]), {
      contentType: 'image/webp',
    });
    expect(size).toBe(data.length);
    expect(await readFile(path.join(root, 'menu_photo/2026/11/stream.webp'))).toEqual(data);
  });

  describe('range reads', () => {
    const KEY = 'review_photo/2026/11/range.webp';
    const DATA = Buffer.from('abcdefghij');

    beforeAll(async () => {
      await driver.put(KEY, DATA, { contentType: 'image/webp' });
    });

    it('reads a byte range inclusive of both ends', async () => {
      const { stream, size } = await driver.getStream(KEY, { start: 2, end: 4 });
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('cde');
      expect(size).toBe(DATA.length); // full size, not the range size
    });

    it('reads from start to EOF when end is omitted', async () => {
      const { stream } = await driver.getStream(KEY, { start: 7 });
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('hij');
    });

    it('clamps end beyond EOF to the last byte', async () => {
      const { stream } = await driver.getStream(KEY, { start: 8, end: 999 });
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('ij');
    });

    it('rejects a start past the end of the file', async () => {
      await expect(driver.getStream(KEY, { start: 50 })).rejects.toThrow(/out of bounds/);
    });
  });

  it('exists/delete reflect the filesystem', async () => {
    await driver.put('message_attachment/2026/11/gone.pdf', Buffer.from('%PDF-1.4'), {
      contentType: 'application/pdf',
    });
    expect(await driver.exists('message_attachment/2026/11/gone.pdf')).toBe(true);
    await driver.delete('message_attachment/2026/11/gone.pdf');
    expect(await driver.exists('message_attachment/2026/11/gone.pdf')).toBe(false);
  });

  it('resolves a relative STORAGE_ROOT against the process cwd', async () => {
    const relDriver = new DiskStorageDriver(path.relative(process.cwd(), root));
    await relDriver.put('avatar/2026/11/rel.webp', Buffer.from('rel'), {
      contentType: 'image/webp',
    });
    const s = await stat(path.join(root, 'avatar/2026/11/rel.webp'));
    expect(s.isFile()).toBe(true);
    // Containment still enforced for relative roots.
    await expect(
      relDriver.put('../../escape.webp', Buffer.from('x'), { contentType: 't' }),
    ).rejects.toThrow(/Invalid storage key/);
  });
});
