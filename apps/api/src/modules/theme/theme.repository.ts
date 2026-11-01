import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { ActiveTheme } from '@app/contracts';
import { DrizzleClient } from '../../db/drizzle.client.js';
// CacheService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import { themePacks, type ThemePackRow } from '../../db/schema/theme.js';

export interface ThemeRepositoryLike {
  listPacks(): Promise<ThemePackRow[]>;
  findPack(id: string): Promise<ThemePackRow | null>;
  updateTokens(id: string, tokens: unknown, updatedBy: string | null): Promise<ThemePackRow | null>;
  getCachedActive(): Promise<ActiveTheme | null>;
  cacheActive(active: ActiveTheme, ttlSec: number): Promise<void>;
  invalidateActiveCache(): Promise<void>;
}

export const THEME_REPOSITORY = Symbol('THEME_REPOSITORY');

const ACTIVE_CACHE_KEY = 'theme:active';

/**
 * Drizzle-backed theme repository (B1.13). Cache access for the active pack
 * goes through the shared CacheService (60 s TTL, invalidated on every
 * admin write — see ThemeService).
 */
@Injectable()
export class ThemeRepository implements ThemeRepositoryLike {
  constructor(
    @Inject(DrizzleClient) private readonly client: DrizzleClient,
    private readonly cache: CacheService,
  ) {}

  async listPacks(): Promise<ThemePackRow[]> {
    return this.client.db.select().from(themePacks).orderBy(themePacks.id);
  }

  async findPack(id: string): Promise<ThemePackRow | null> {
    const rows = await this.client.db
      .select()
      .from(themePacks)
      .where(eq(themePacks.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateTokens(
    id: string,
    tokens: unknown,
    updatedBy: string | null,
  ): Promise<ThemePackRow | null> {
    const rows = await this.client.db
      .update(themePacks)
      .set({
        tokens: tokens as Record<string, unknown>,
        version: sql`${themePacks.version} + 1`,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(themePacks.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async getCachedActive(): Promise<ActiveTheme | null> {
    return this.cache.get<ActiveTheme>(ACTIVE_CACHE_KEY);
  }

  async cacheActive(active: ActiveTheme, ttlSec: number): Promise<void> {
    await this.cache.set(ACTIVE_CACHE_KEY, active, ttlSec);
  }

  async invalidateActiveCache(): Promise<void> {
    await this.cache.del(ACTIVE_CACHE_KEY);
  }
}
