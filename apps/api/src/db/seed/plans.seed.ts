import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { plans } from '../../db/schema/billing.js';
import { loadEnv } from '../../config/env.js';
import { registerSeeder } from './registry.js';
/**
 * plans seeder (B8.2) — INSERT-IF-ABSENT: the four builtin tiers land once;
 * admin-edited prices/limits are never overwritten by a reseed. The free tier
 * is the default fallback when a business has no subscription (the
 * BillingService returns FREE_TIER_LIMITS when no active subscription exists).
 *
 * The `limits` column is JSON-as-string (v1 simplicity); the seeder writes
 * the canonical caps. An admin can edit a tier's price/limits via the admin
 * API (B8.4) without touching this seeder.
 */
const SEED_PLANS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    tier: 'free' as const,
    nameKey: 'billing.plan.free.name',
    priceMonthly: 0,
    priceYearly: 0,
    limits: JSON.stringify({
      galleryPhotos: 8,
      menuItems: 20,
      videos: false,
      ai: false,
      ads: false,
      adCampaigns: 0,
    }),
    isActive: true,
    sortOrder: 0,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    tier: 'starter' as const,
    nameKey: 'billing.plan.starter.name',
    priceMonthly: 49_000, // 49,000 Tomans/month ≈ $1
    priceYearly: 490_000, // ~10× monthly
    limits: JSON.stringify({
      galleryPhotos: 30,
      menuItems: 100,
      videos: false,
      ai: false,
      ads: true,
      adCampaigns: 1,
    }),
    isActive: true,
    sortOrder: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    tier: 'pro' as const,
    nameKey: 'billing.plan.pro.name',
    priceMonthly: 149_000, // 149,000 Tomans/month ≈ $3
    priceYearly: 1_490_000,
    limits: JSON.stringify({
      galleryPhotos: 100,
      menuItems: 500,
      videos: true,
      ai: true,
      ads: true,
      adCampaigns: 5,
    }),
    isActive: true,
    sortOrder: 2,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    tier: 'enterprise' as const,
    nameKey: 'billing.plan.enterprise.name',
    priceMonthly: 490_000, // 490,000 Tomans/month ≈ $10
    priceYearly: 4_900_000,
    limits: JSON.stringify({
      galleryPhotos: 1000,
      menuItems: 10_000,
      videos: true,
      ai: true,
      ads: true,
      adCampaigns: 50,
    }),
    isActive: false, // hidden — admin-only, quoted manually
    sortOrder: 3,
  },
];

export async function seedPlans(databaseUrl: string, log: (message: string) => void): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { casing: 'snake_case' });
    for (const plan of SEED_PLANS) {
      await db
        .insert(plans)
        .values(plan)
        .onConflictDoNothing({ target: plans.id });
    }
    log(`plans: seeded ${SEED_PLANS.length} plans (free + starter + pro active; enterprise hidden)`);
  } finally {
    await pool.end();
  }
}

function seedDatabaseUrl(): string {
  const env = loadEnv();
  return process.argv.includes('--test')
    ? env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL ?? env.DATABASE_URL);
}

registerSeeder({
  name: 'plans',
  run: async () => {
    await seedPlans(seedDatabaseUrl(), (msg) =>
      process.stdout.write(`[db:seed] plans: ${msg}\n`),
    );
  },
});
