import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CacheService } from '../src/redis/cache.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import type { SettingsRepositoryLike } from '../src/modules/settings/settings.repository.js';
import type { SettingRow } from '../src/db/schema/settings.js';
import { registerSettingDefinitionForTests } from '../src/modules/settings/settings.registry.js';
import { FakeRedis } from './fake-redis.js';

const KEY_MATERIAL = 'unit-test-key-material-0123456789abcdef-0123456789';
process.env.SETTINGS_ENCRYPTION_KEY = KEY_MATERIAL;

// A temporary SECRET key so the secret storage path can be tested without
// polluting the production registry (real secret keys arrive with B1.5+).
registerSettingDefinitionForTests({
  key: 'test.api_token',
  schema: z.object({ token: z.string().min(1) }).strict(),
  default: { token: 'unset' },
  group: 'integrations',
  public: false,
  isSecret: true,
  description: 'test-only secret definition',
});

function makeRepo(): SettingsRepositoryLike & { store: Map<string, SettingRow> } {
  const store = new Map<string, SettingRow>();
  return {
    store,
    async findAll() {
      return [...store.values()];
    },
    async findByKey(key) {
      return store.get(key) ?? null;
    },
    async upsert(params) {
      const row: SettingRow = {
        key: params.key,
        value: params.value,
        isSecret: params.isSecret,
        group: params.group,
        description: params.description,
        updatedAt: new Date(),
      };
      store.set(params.key, row);
      return row;
    },
    async deleteByKey(key) {
      return store.delete(key);
    },
  };
}

function makeService() {
  const repo = makeRepo();
  const cache = new CacheService(new FakeRedis());
  const service = new SettingsService(repo, cache);
  return { repo, cache, service };
}

afterEach(() => {
  delete process.env.SETTINGS_ENCRYPTION_KEY_MISSING;
});

describe('SettingsService (B1.1)', () => {
  it('returns the registry default when no override is stored', async () => {
    const { service } = makeService();
    await expect(service.get('site.name')).resolves.toBe('Local Business Directory');
    await expect(service.get('site.timezone')).resolves.toBe('Asia/Tehran');
  });

  it('stores non-secret values as plain JSON and reads them back', async () => {
    const { service, repo } = makeService();
    await service.set('site.name', 'بازار تهران');
    expect(await service.get('site.name')).toBe('بازار تهران');
    const stored = repo.store.get('site.name');
    expect(stored?.value).toBe('بازار تهران'); // plaintext, not an envelope
    expect(stored?.isSecret).toBe(false);
  });

  it('encrypts secret values at rest, decrypts on read, and never stores plaintext', async () => {
    const { service, repo } = makeService();
    await service.set('test.api_token', { token: 'p@ss-توکن' });
    const stored = repo.store.get('test.api_token');
    expect(stored?.isSecret).toBe(true);
    const raw = String(stored?.value);
    expect(raw.startsWith('v1.')).toBe(true);
    expect(raw).not.toContain('p@ss'); // plaintext never reaches the DB layer

    // A fresh service instance (cold cache) decrypts the stored envelope.
    const cold = new SettingsService(repo, new CacheService(new FakeRedis()));
    const decoded = await cold.get('test.api_token');
    expect(decoded).toEqual({ token: 'p@ss-توکن' });
  });

  it('rejects unknown keys with 422 and invalid values with 400', async () => {
    const { service } = makeService();
    await expect(service.set('nope.key', 1)).rejects.toMatchObject({ status: 422 });
    await expect(service.set('site.timezone', 'Mars/Olympus')).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.set('test.api_token', { wrong: 'shape' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('masks secret values in admin listings and never leaks them', async () => {
    const { service } = makeService();
    await service.set('test.api_token', { token: 'topsecret' });
    const list = await service.listAll();
    const secretRow = list.find((s) => s.key === 'test.api_token');
    expect(secretRow?.value).toBe('••••••••');
    expect(secretRow?.isDefault).toBe(false);
    expect(JSON.stringify(list)).not.toContain('topsecret');
    // Plain values still show, and untouched keys are marked as defaults.
    const name = list.find((s) => s.key === 'site.name');
    expect(name?.isDefault).toBe(true);
    expect(name?.value).toBe('Local Business Directory');
  });

  it('public blob includes only public non-secret keys and honors overrides', async () => {
    const { service } = makeService();
    await service.set('site.name', 'دایرکتوری');
    const blob = await service.getPublic();
    expect(blob['site.name']).toBe('دایرکتوری');
    expect(blob['site.timezone']).toBe('Asia/Tehran');
    expect(blob['test.api_token']).toBeUndefined(); // secret + non-public never leak
  });

  it('reset removes the override so the default becomes effective again', async () => {
    const { service, repo } = makeService();
    await service.set('site.name', 'custom');
    expect(await service.get('site.name')).toBe('custom');
    const after = await service.reset('site.name');
    expect(after.isDefault).toBe(true);
    expect(after.value).toBe('Local Business Directory');
    expect(repo.store.size).toBe(0);
    expect(await service.get('site.name')).toBe('Local Business Directory');
  });

  it('invalidates the cache on write: the next read sees the fresh value', async () => {
    const { service } = makeService();
    await service.get('site.name'); // warm the cache with the default
    await service.set('site.name', 'updated');
    expect(await service.get('site.name')).toBe('updated');
  });

  it('fails loudly (503) when the encryption key is missing for a secret read', async () => {
    const { service, repo } = makeService();
    await service.set('test.api_token', { token: 'x' });
    const previous = process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    // Cold service so the cached decrypted value is not served.
    const cold = new SettingsService(repo, new CacheService(new FakeRedis()));
    await expect(cold.get('test.api_token')).rejects.toMatchObject({ status: 503 });
    process.env.SETTINGS_ENCRYPTION_KEY = previous;
  });
});
