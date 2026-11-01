import { Inject, Injectable } from '@nestjs/common';
// SettingsService is constructor-injected: Nest reads its type at runtime
// from emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

/**
 * Resolves the effective SMTP configuration (B1.6): a settings value wins
 * when it was set by an admin, otherwise the SMTP_* env default applies
 * (Mailpit localhost:1025 in dev). Read at SEND time — panel changes apply
 * to the next message without a restart. Secrets are never logged here.
 */
@Injectable()
export class EmailCredentialsService {
  constructor(
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  async smtp(): Promise<SmtpConfig> {
    const [host, port, secure, user, password, fromAddress, fromName] = await Promise.all([
      this.settings.get<string>('email.smtp.host'),
      this.settings.get<number | null>('email.smtp.port'),
      this.settings.get<boolean | null>('email.smtp.secure'),
      this.settings.get<string>('email.smtp.user'),
      this.settings.get<string>('email.smtp.password'),
      this.settings.get<string>('email.from.address'),
      this.settings.get<string>('email.from.name'),
    ]);
    const cfg = this.appConfig;
    return {
      host: host || cfg.smtpHost,
      port: port && port > 0 ? port : cfg.smtpPort,
      secure: secure ?? cfg.smtpSecure,
      user: user || cfg.smtpUser,
      password: password || cfg.smtpPassword,
      fromAddress: fromAddress || cfg.smtpFrom,
      fromName: fromName || '',
    };
  }

  /** Site default locale — used when a job carries no locale of its own. */
  async siteLocale(): Promise<'fa' | 'en'> {
    return this.settings.get<'fa' | 'en'>('site.locale');
  }
}
