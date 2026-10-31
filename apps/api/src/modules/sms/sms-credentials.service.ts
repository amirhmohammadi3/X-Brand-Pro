import { Injectable } from '@nestjs/common';
// SettingsService is constructor-injected: Nest reads its type at runtime
// from emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';

export type SmsProviderName = 'fake' | 'melipayamak' | 'kavenegar';

export interface MelipayamakCredentials {
  username: string;
  password: string;
  sender: string;
  otpBodyId: string;
}

export interface KavenegarCredentials {
  apiKey: string;
  sender: string;
  otpTemplate: string;
}

/**
 * Reads SMS settings for the drivers (B1.5). A separate service keeps the
 * drivers decoupled from SettingsService and avoids the
 * SmsService → drivers → SmsService cycle (each driver needs credentials at
 * SEND time — the active provider can change between enqueue and process).
 */
@Injectable()
export class SmsCredentialsService {
  constructor(private readonly settings: SettingsService) {}

  async provider(): Promise<SmsProviderName> {
    return this.settings.get<SmsProviderName>('sms.provider');
  }

  async melipayamak(): Promise<MelipayamakCredentials> {
    const [username, password, sender, otpBodyId] = await Promise.all([
      this.settings.get<string>('sms.melipayamak.username'),
      this.settings.get<string>('sms.melipayamak.password'),
      this.settings.get<string>('sms.melipayamak.sender'),
      this.settings.get<string>('sms.melipayamak.otpBodyId'),
    ]);
    return { username, password, sender, otpBodyId };
  }

  async kavenegar(): Promise<KavenegarCredentials> {
    const [apiKey, sender, otpTemplate] = await Promise.all([
      this.settings.get<string>('sms.kavenegar.apiKey'),
      this.settings.get<string>('sms.kavenegar.sender'),
      this.settings.get<string>('sms.kavenegar.otpTemplate'),
    ]);
    return { apiKey, sender, otpTemplate };
  }

  /** Site default locale for OTP texts when the user has none (B1.5). */
  async siteLocale(): Promise<'fa' | 'en'> {
    return this.settings.get<'fa' | 'en'>('site.locale');
  }
}
