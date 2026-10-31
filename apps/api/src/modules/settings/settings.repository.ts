import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { settings, type SettingRow } from '../../db/schema/settings.js';

/**
 * All Drizzle access for the settings domain lives here (AGENTS.md 6:
 * services never import `db` directly). The narrow method set doubles as the
 * interface unit tests fake.
 */
export interface SettingsRepositoryLike {
  findAll(): Promise<SettingRow[]>;
  findByKey(key: string): Promise<SettingRow | null>;
  upsert(params: {
    key: string;
    value: unknown;
    isSecret: boolean;
    group: string;
    description: string;
  }): Promise<SettingRow>;
  deleteByKey(key: string): Promise<boolean>;
}

@Injectable()
export class SettingsRepository implements SettingsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findAll(): Promise<SettingRow[]> {
    return this.client.db.select().from(settings);
  }

  async findByKey(key: string): Promise<SettingRow | null> {
    const rows = await this.client.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows[0] ?? null;
  }

  async upsert(params: {
    key: string;
    value: unknown;
    isSecret: boolean;
    group: string;
    description: string;
  }): Promise<SettingRow> {
    const rows = await this.client.db
      .insert(settings)
      .values({
        key: params.key,
        value: params.value,
        isSecret: params.isSecret,
        group: params.group,
        description: params.description,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: params.value,
          isSecret: params.isSecret,
          group: params.group,
          description: params.description,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`settings upsert returned no row for key "${params.key}"`);
    return row;
  }

  async deleteByKey(key: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(settings)
      .where(eq(settings.key, key))
      .returning({ key: settings.key });
    return rows.length > 0;
  }
}
