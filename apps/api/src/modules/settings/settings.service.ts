import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminSetting } from '@app/contracts';
// CacheService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import { decryptSecret, encryptSecret, isEncryptedEnvelope, SECRET_MASK } from './secret-crypto.js';
import { listAllSettingDefinitions, lookupSettingDefinition } from './settings.registry.js';
import type { SettingsRepositoryLike } from './settings.repository.js';

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

/**
 * Runtime settings (B1.1). Reads go through the Redis cache (60s TTL);
 * writes validate against the registry schema, encrypt secrets at rest,
 * upsert via the repository and invalidate the affected cache entries.
 * Secret plaintext is NEVER cached and NEVER returned by admin listings —
 * only the fixed mask.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(SETTINGS_REPOSITORY) private readonly repo: SettingsRepositoryLike,
    private readonly cache: CacheService,
  ) {}

  /**
   * Resolved value for a registered key: stored override (decrypted when
   * secret) or the registry default. Throws 404 for unregistered keys.
   */
  async get<T = unknown>(key: string): Promise<T> {
    const definition = this.mustGetDefinition(key);
    const cached = await this.cache.get<unknown>(this.cacheKey(key));
    if (cached !== null) {
      return this.decode(definition.isSecret, cached) as T;
    }
    const row = await this.repo.findByKey(key);
    const raw = row ? row.value : definition.default;
    await this.cache.set(this.cacheKey(key), raw, this.ttl());
    return this.decode(definition.isSecret, raw) as T;
  }

  /**
   * Non-secret values for all registry keys flagged `public` — the payload
   * the web app fetches for theme/locale/site identity. Cached as one blob.
   */
  async getPublic(): Promise<Record<string, unknown>> {
    return this.cache.wrap('settings:public', this.ttl(), async () => {
      const rows = await this.repo.findAll();
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const out: Record<string, unknown> = {};
      for (const definition of listAllSettingDefinitions()) {
        if (!definition.public || definition.isSecret) continue;
        out[definition.key] =
          byKey.get(definition.key) !== undefined ? byKey.get(definition.key) : definition.default;
      }
      return out;
    });
  }

  /**
   * Admin listing: every registered key with its current value. Secret
   * values are masked and marked `isDefault` so the UI never round-trips a
   * secret it does not need.
   */
  async listAll(): Promise<AdminSetting[]> {
    const rows = await this.repo.findAll();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return listAllSettingDefinitions().map((definition) => {
      const row = byKey.get(definition.key);
      const value = row ? row.value : definition.default;
      return {
        key: definition.key,
        value: definition.isSecret ? SECRET_MASK : value,
        group: definition.group,
        isSecret: definition.isSecret,
        isDefault: !row,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      };
    });
  }

  /**
   * Validates and stores an override. Unknown keys and schema violations are
   * rejected (422 / 400); secrets are encrypted before they reach the
   * repository. Returns the admin view of the written key.
   */
  async set(key: string, value: unknown): Promise<AdminSetting> {
    const definition = this.mustGetDefinition(key);
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new HttpException(
        {
          code: 'VALIDATION_FAILED' as const,
          message: `Invalid value for setting "${key}"`,
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const stored = definition.isSecret
      ? encryptSecret(JSON.stringify(parsed.data), this.keyMaterial())
      : parsed.data;
    const row = await this.repo.upsert({
      key,
      value: stored,
      isSecret: definition.isSecret,
      group: definition.group,
      description: definition.description,
    });
    await this.invalidate(key);
    return {
      key,
      value: definition.isSecret ? SECRET_MASK : row.value,
      group: definition.group,
      isSecret: definition.isSecret,
      isDefault: false,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Removes an override; the registry default becomes effective again. */
  async reset(key: string): Promise<AdminSetting> {
    const definition = this.mustGetDefinition(key);
    await this.repo.deleteByKey(key);
    await this.invalidate(key);
    return {
      key,
      value: definition.isSecret ? SECRET_MASK : definition.default,
      group: definition.group,
      isSecret: definition.isSecret,
      isDefault: true,
      updatedAt: null,
    };
  }

  private decode(isSecret: boolean, raw: unknown): unknown {
    if (!isSecret) return raw;
    if (typeof raw !== 'string' || !isEncryptedEnvelope(raw)) {
      this.logger.error(`Secret setting has a non-envelope stored value — refusing to decode`);
      throw new HttpException(
        { code: 'INTERNAL_ERROR' as const, message: 'Secret setting is corrupted' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return JSON.parse(decryptSecret(raw, this.keyMaterial())) as unknown;
  }

  private async invalidate(key: string): Promise<void> {
    await Promise.all([this.cache.del(this.cacheKey(key)), this.cache.del('settings:public')]);
  }

  private mustGetDefinition(key: string) {
    const definition = lookupSettingDefinition(key);
    if (!definition) {
      throw new HttpException(
        { code: 'UNPROCESSABLE' as const, message: `Unknown setting key "${key}"` },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return definition;
  }

  private cacheKey(key: string): string {
    return `settings:key:${key}`;
  }

  private ttl(): number {
    return 60;
  }

  private keyMaterial(): string {
    const material = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!material || material.length < 32) {
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE' as const,
          message: 'SETTINGS_ENCRYPTION_KEY is missing or too short',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return material;
  }
}
