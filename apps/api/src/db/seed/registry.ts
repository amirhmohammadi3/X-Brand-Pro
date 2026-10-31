/**
 * Seeder registry (B1.3 moves it here so seeders and the CLI runner don't
 * import each other in a cycle). Seeders register themselves from their
 * domain seed files; every seeder must be idempotent.
 */
export type Seeder = {
  /** Stable machine name, e.g. "cities-1". Used for logs and future bookkeeping. */
  name: string;
  /** Must be idempotent (upsert / ON CONFLICT DO NOTHING, never blind INSERT). */
  run: (db: unknown) => Promise<void>;
};

const registered: Seeder[] = [];

export function registerSeeder(seeder: Seeder): void {
  registered.push(seeder);
}

export function listSeeders(): readonly Seeder[] {
  return registered;
}

export async function runSeeders(): Promise<string[]> {
  const ran: string[] = [];
  for (const seeder of registered) {
    await seeder.run(undefined);
    ran.push(seeder.name);
  }
  return ran;
}
