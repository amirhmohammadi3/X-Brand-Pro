import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { oauthAccounts, type OauthAccountRow } from '../../db/schema/oauth.js';

/** DI token for the oauth accounts repository (faked in unit/API tests). */
export const OAUTH_ACCOUNTS_REPOSITORY = Symbol('OAUTH_ACCOUNTS_REPOSITORY');

/**
 * Narrow Drizzle surface for linked external identities (AGENTS.md 6).
 * Faked in unit/API tests with an in-memory implementation.
 */
export interface OauthAccountsRepositoryLike {
  insert(row: {
    userId: string;
    provider: 'google';
    providerUserId: string;
    email: string | null;
  }): Promise<OauthAccountRow>;
  findByProviderUid(provider: string, providerUserId: string): Promise<OauthAccountRow | null>;
  listForUser(userId: string): Promise<OauthAccountRow[]>;
  findByIdForUser(id: string, userId: string): Promise<OauthAccountRow | null>;
  deleteByIdForUser(id: string, userId: string): Promise<boolean>;
  /** B1.10 account deletion: unlink every external identity of the user. */
  deleteForUser(userId: string): Promise<number>;
  countForUser(userId: string): Promise<number>;
}

@Injectable()
export class OauthAccountsRepository implements OauthAccountsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async insert(row: {
    userId: string;
    provider: 'google';
    providerUserId: string;
    email: string | null;
  }): Promise<OauthAccountRow> {
    const rows = await this.client.db
      .insert(oauthAccounts)
      .values({
        userId: row.userId,
        provider: row.provider,
        providerUserId: row.providerUserId,
        email: row.email,
      })
      .onConflictDoNothing({
        target: [oauthAccounts.provider, oauthAccounts.providerUserId],
      })
      .returning();
    const inserted = rows[0];
    if (!inserted) {
      // Unique (provider, provider_user_id) raced with a concurrent link.
      const existing = await this.findByProviderUid(row.provider, row.providerUserId);
      if (!existing) throw new Error('oauth_accounts insert returned no row');
      return existing;
    }
    return inserted;
  }

  async findByProviderUid(
    provider: string,
    providerUserId: string,
  ): Promise<OauthAccountRow | null> {
    const rows = await this.client.db
      .select()
      .from(oauthAccounts)
      .where(
        and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteForUser(userId: string): Promise<number> {
    const rows = await this.client.db
      .delete(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .returning();
    return rows.length;
  }

  async listForUser(userId: string): Promise<OauthAccountRow[]> {
    return this.client.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .orderBy(oauthAccounts.createdAt);
  }

  async findByIdForUser(id: string, userId: string): Promise<OauthAccountRow | null> {
    const rows = await this.client.db
      .select()
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.id, id), eq(oauthAccounts.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteByIdForUser(id: string, userId: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.id, id), eq(oauthAccounts.userId, userId)))
      .returning({ id: oauthAccounts.id });
    return rows.length > 0;
  }

  async countForUser(userId: string): Promise<number> {
    const rows = await this.client.db
      .select({ id: oauthAccounts.id })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));
    return rows.length;
  }
}
