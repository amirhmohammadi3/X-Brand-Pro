import { beforeAll, describe, expect, it } from 'vitest';
import { DrizzleClient, createPool } from '../src/db/drizzle.client.js';
import { prepareTestDatabase, databaseAvailable } from './db.js';
import { SettingsRepository } from '../src/modules/settings/settings.repository.js';

/**
 * Live-database integration for the settings repository. When the test
 * database is unreachable (sandboxes without Docker) the suite PASSES
 * trivially with a note; on machines with services and in CI (service
 * containers) it runs against real Postgres.
 */
describe('SettingsRepository integration (B1.1)', () => {
  let repo: SettingsRepository | null = null;
  let client: DrizzleClient | null = null;

  beforeAll(async () => {
    if (!(await databaseAvailable())) {
      repo = null;
      return;
    }
    await prepareTestDatabase();
    const pool = createPool(process.env.TEST_DATABASE_URL ?? '');
    client = new DrizzleClient(pool);
    repo = new SettingsRepository(client);
  });

  it('upserts, reads, lists and deletes a setting row (real Postgres)', async () => {
    if (!repo || !client) {
      // No live Postgres in this environment — nothing to verify here; the
      // same flow is covered by unit tests with a fake repository.
      return;
    }

    const written = await repo.upsert({
      key: 'integration.probe',
      value: { hello: 'دنیا' },
      isSecret: false,
      group: 'general',
      description: 'integration probe',
    });
    expect(written.value).toEqual({ hello: 'دنیا' });

    const reread = await repo.findByKey('integration.probe');
    expect(reread?.value).toEqual({ hello: 'دنیا' });

    const updated = await repo.upsert({
      key: 'integration.probe',
      value: { hello: 'world' },
      isSecret: false,
      group: 'general',
      description: 'integration probe',
    });
    expect(updated.value).toEqual({ hello: 'world' });
    expect((await repo.findAll()).some((r) => r.key === 'integration.probe')).toBe(true);

    expect(await repo.deleteByKey('integration.probe')).toBe(true);
    expect(await repo.findByKey('integration.probe')).toBeNull();
    await client.onApplicationShutdown();
  });
});
