import { z } from 'zod';

/**
 * Settings schemas (B1.1). Runtime configuration that an admin may change
 * lives in the `settings` table; every key is registered in
 * `apps/api/src/modules/settings/settings.registry.ts` with its own Zod
 * schema. The contracts here cover the WIRE shapes only — the per-key value
 * validation happens server-side through the registry.
 */

/** Dotted lowercase key, e.g. `site.name`, `sms.driver`. */
export const settingKeySchema = z
  .string()
  .min(3)
  .max(100)
  // Mixed-case segments are allowed: the B1.1 registry already contains
  // `sms.kavenegar.apiKey`, and the wire format must admit every registered
  // key (B1.11).
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/, 'settings.key_format');
export type SettingKey = z.infer<typeof settingKeySchema>;

/** Admin-managed groups (the registry may add more; the wire type stays open). */
export const settingsGroupSchema = z.string().min(1).max(50);
export type SettingsGroup = z.infer<typeof settingsGroupSchema>;

/** One setting as the admin API returns it (secret values are always masked). */
export const adminSettingSchema = z.object({
  key: settingKeySchema,
  value: z.unknown(),
  group: settingsGroupSchema,
  isSecret: z.boolean(),
  isDefault: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});
export type AdminSetting = z.infer<typeof adminSettingSchema>;

/** Public settings blob: only registry keys flagged `public` and never secrets. */
export const publicSettingsSchema = z.record(z.unknown());
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

/**
 * PUT /admin/settings/:key body (B1.11). Secrets are write-only: `value` is
 * required but never echoed back. An EMPTY string on a secret means "keep
 * unchanged" and is rejected with 422 unless `clear: true` removes the
 * override (the registry default becomes effective).
 */
export const updateSettingBodySchema = z
  .object({
    value: z.unknown(),
    clear: z.boolean().optional(),
  })
  .strict();
export type UpdateSettingBody = z.infer<typeof updateSettingBodySchema>;
