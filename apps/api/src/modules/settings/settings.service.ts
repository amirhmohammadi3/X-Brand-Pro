import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI metadata
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AdminSetting } from '@app/contracts';
// CacheService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import { decryptSecret, encryptSecret, isEncryptedEnvelope, SECRET_MASK } from './secret-crypto.js';
import { listAllSettingDefinitions, lookupSettingDefinition } from './settings.registry.js';
import type { SettingsRepositoryLike } from './settings.repository.js';

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

/** Domain events emitted by the settings service (audit subscribes in B1.11). */
export const SETTINGS_EVENTS = {
  updated: 'settings.updated',
} as const;

/** Who made the change — captured by the admin controller, never guessed. */
export interface SettingsActor {
  id?: string | null;
  role?: string | null;
  /** B1.11: an empty secret value with clear=true removes the override. */
  clear?: boolean;
}

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

    private readonly events: EventEmitter2,
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
  async set(key: string, value: unknown, actor?: SettingsActor): Promise<AdminSetting> {
    const definition = this.mustGetDefinition(key);

    // B1.11 secret write rules: '' means "keep unchanged" (rejected) unless
    // { clear: true } removes the override and the registry default applies.
    if (definition.isSecret && typeof value === 'string' && value.length === 0) {
      if (actor?.clear === true) {
        return this.reset(key, actor);
      }
      throw new HttpException(
        {
          code: 'UNPROCESSABLE' as const,
          message: 'Empty value on a secret keeps the current one; send clear:true to remove it',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const before = await this.maskedCurrent(key);
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
    const view: AdminSetting = {
      key,
      value: definition.isSecret ? SECRET_MASK : row.value,
      group: definition.group,
      isSecret: definition.isSecret,
      isDefault: false,
      updatedAt: row.updatedAt.toISOString(),
    };
    this.events.emit(SETTINGS_EVENTS.updated, {
      key,
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      before,
      after: definition.isSecret ? { redacted: SECRET_MASK, changed: true } : view.value,
      changed: true,
      action: 'settings.update',
    });
    return view;
  }

  /** Removes an override; the registry default becomes effective again. */
  async reset(key: string, actor?: SettingsActor): Promise<AdminSetting> {
    const definition = this.mustGetDefinition(key);
    const before = await this.maskedCurrent(key);
    await this.repo.deleteByKey(key);
    await this.invalidate(key);
    const view: AdminSetting = {
      key,
      value: definition.isSecret ? SECRET_MASK : definition.default,
      group: definition.group,
      isSecret: definition.isSecret,
      isDefault: true,
      updatedAt: null,
    };
    this.events.emit(SETTINGS_EVENTS.updated, {
      key,
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      before,
      after: definition.isSecret
        ? { redacted: SECRET_MASK, changed: true, cleared: true }
        : view.value,
      changed: true,
      action: 'settings.reset',
    });
    return view;
  }

  /**
   * Masked snapshot of the CURRENT value for audit before/after: secrets
   * contribute the mask (or null when unset) — never plaintext.
   */
  private async maskedCurrent(key: string): Promise<unknown> {
    const definition = lookupSettingDefinition(key);
    if (!definition) return null;
    const row = await this.repo.findByKey?.(key);
    if (!row) return null;
    return definition.isSecret ? { redacted: SECRET_MASK, changed: true } : row.value;
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
