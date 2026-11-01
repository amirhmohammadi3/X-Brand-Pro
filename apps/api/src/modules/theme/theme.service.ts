import { Inject, Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
  defaultPackTokens,
  themePackIdSchema,
  themeTokensSchema,
  validatePackContrast,
  type ActiveTheme,
  type ThemePack,
  type ThemePackId,
  type ThemeTokens,
} from '@app/contracts';
import { createHash } from 'node:crypto';
// SettingsService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
import { THEME_REPOSITORY, type ThemeRepositoryLike } from './theme.repository.js';

export const THEME_EVENTS = {
  activeChanged: 'theme.active.changed',
  tokensUpdated: 'theme.tokens.updated',
} as const;

const ACTIVE_TTL_SEC = 60;

/** `tokens` jsonb arrives as unknown from the DB — parse defensively. */
function parseTokens(raw: unknown): ThemeTokens {
  return themeTokensSchema.parse(raw);
}

function toPack(row: {
  id: string;
  names: Record<string, string>;
  tokens: unknown;
  version: number;
}): ThemePack {
  const parsed = themePackIdSchema.safeParse(row.id);
  return {
    id: parsed.success ? parsed.data : 'modern',
    names: row.names,
    tokens: parseTokens(row.tokens),
    version: row.version,
  };
}

function unprocessable(message: string, details?: unknown): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE', message, details },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

@Injectable()
export class ThemeService {
  constructor(
    @Inject(THEME_REPOSITORY) private readonly repo: ThemeRepositoryLike,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The active pack for the public endpoint. Read-through cache in Redis
   * (60 s); every admin write invalidates it. `version` combines pack id,
   * pack version and a token hash so F1.2 can bust CSS reliably.
   */
  async getActive(): Promise<ActiveTheme> {
    const cached = await this.repo.getCachedActive();
    if (cached) return cached;

    const packIdRaw = await this.settings.get('theme.activePackId');
    const parsedId = themePackIdSchema.safeParse(packIdRaw ?? 'modern');
    const packId = parsedId.success ? parsedId.data : 'modern';
    const row = await this.repo.findPack(packId);
    if (!row) throw new NotFoundException(`theme pack not found: ${packId}`);

    const pack = toPack(row);
    const active: ActiveTheme = {
      pack: { id: pack.id, names: pack.names, tokens: pack.tokens },
      version: this.versionString(pack),
    };
    await this.repo.cacheActive(active, ACTIVE_TTL_SEC);
    return active;
  }

  /** `<id>:<packVersion>:<tokenHash[:8]>` — changes on every token edit. */
  private versionString(pack: ThemePack): string {
    const hash = createHash('sha1').update(JSON.stringify(pack.tokens)).digest('hex').slice(0, 8);
    return `${pack.id}:${pack.version}:${hash}`;
  }

  async listPacks(): Promise<
    Array<{
      id: ThemePackId;
      names: Record<string, string>;
      isActive: boolean;
      version: number;
      preview: {
        light: [string, string, string, string, string];
        dark: [string, string, string, string, string];
      };
    }>
  > {
    const activeId = (await this.getActive()).pack.id;
    const rows = await this.repo.listPacks();
    return rows.map((row) => {
      const pack = toPack(row);
      return {
        id: pack.id,
        names: pack.names,
        isActive: pack.id === activeId,
        version: pack.version,
        preview: {
          light: [
            pack.tokens.light.bg,
            pack.tokens.light.surface,
            pack.tokens.light.primary,
            pack.tokens.light.text,
            pack.tokens.light.accent,
          ],
          dark: [
            pack.tokens.dark.bg,
            pack.tokens.dark.surface,
            pack.tokens.dark.primary,
            pack.tokens.dark.text,
            pack.tokens.dark.accent,
          ],
        },
      };
    });
  }

  async getPack(id: string): Promise<ThemePack> {
    const row = await this.repo.findPack(id);
    if (!row) throw new NotFoundException(`theme pack not found: ${id}`);
    return toPack(row);
  }

  /** Switches the active pack through SettingsService; invalidates the cache. */
  async setActive(packId: ThemePackId, actorId: string | null): Promise<ActiveTheme> {
    const row = await this.repo.findPack(packId);
    if (!row) throw new NotFoundException(`theme pack not found: ${packId}`);
    await this.settings.set('theme.activePackId', packId, { id: actorId, role: null });
    await this.repo.invalidateActiveCache();
    return this.getActive();
  }

  /**
   * Replaces a pack's tokens. Validates shape (themeTokensSchema at the
   * pipe) AND contrast (validatePackContrast) — rejects with a 422 whose
   * `details` list every failing pair with its computed ratio. Bumps the
   * pack version and invalidates the cache.
   */
  async updateTokens(
    packId: string,
    tokens: ThemeTokens,
    actorId: string | null,
  ): Promise<ThemePack> {
    const row = await this.repo.findPack(packId);
    if (!row) throw new NotFoundException(`theme pack not found: ${packId}`);

    const failures = validatePackContrast(tokens);
    if (failures.length > 0) {
      throw unprocessable('Theme tokens fail the contrast requirements', { failedPairs: failures });
    }

    const updated = await this.repo.updateTokens(packId, tokens, actorId);
    if (!updated) throw new NotFoundException(`theme pack not found: ${packId}`);
    await this.repo.invalidateActiveCache();
    return toPack(updated);
  }

  /** Restores the shipped tokens of a builtin pack (contracts/packs.ts). */
  async resetToDefault(packId: string, actorId: string | null): Promise<ThemePack> {
    const shipped = defaultPackTokens(themePackIdSchema.parse(packId));
    if (!shipped) throw new NotFoundException(`theme pack not found: ${packId}`);
    return this.updateTokens(packId, structuredClone(shipped), actorId);
  }
}
