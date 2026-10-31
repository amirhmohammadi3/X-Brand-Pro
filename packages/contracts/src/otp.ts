import { z } from 'zod';

/**
 * One-time-code wire shapes (B1.4). The CODE ITSELF never crosses the API:
 * `otpRequestResultSchema` is what a controller may return (B1.7 uses it);
 * the raw code is handed only to the sending service by `OtpService.issue`.
 */

export const OTP_CHANNELS = ['sms', 'email'] as const;
export const otpChannelSchema = z.enum(OTP_CHANNELS);
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export const OTP_PURPOSES = [
  'login',
  'verify_email',
  'verify_phone',
  'reset_password',
  'change_email',
  'change_phone',
] as const;
export const otpPurposeSchema = z.enum(OTP_PURPOSES);
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/** What B1.7's endpoints return after issuing an OTP (never the code). */
export const otpRequestResultSchema = z.object({
  resendAfterSec: z.number().int().min(1),
  expiresInSec: z.number().int().min(1),
  channel: otpChannelSchema,
  targetMasked: z.string().min(3),
});
export type OtpRequestResult = z.infer<typeof otpRequestResultSchema>;
