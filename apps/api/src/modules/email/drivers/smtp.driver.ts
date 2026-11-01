import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { createTransport } from 'nodemailer';
// EmailCredentialsService is constructor-injected: Nest reads its type at
// runtime from emitDecoratorMetadata, so it must stay a value import even
// though it is not used as a value in this file (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EmailCredentialsService, type SmtpConfig } from '../email-credentials.service.js';
import { toEmailProviderError } from '../email.driver.js';
import type { EmailDriver, EmailMessage, EmailSendResult } from '../email.driver.js';

/**
 * Nodemailer SMTP driver (B1.6). One pooled transport is kept alive; it is
 * rebuilt whenever the effective SMTP settings change, detected by hashing
 * the config (host, port, secure, user, password) — the password never
 * enters logs, only the hash. `verify()` powers the non-critical `smtp`
 * health indicator and is cached for 60 seconds.
 */
@Injectable()
export class SmtpDriver implements EmailDriver {
  readonly name = 'smtp';

  private transport: Transporter | null = null;
  private transportHash = '';
  private verifyCache: { at: number; ok: boolean } | null = null;

  constructor(private readonly credentials: EmailCredentialsService) {}

  async send(mail: EmailMessage): Promise<EmailSendResult> {
    const config = await this.credentials.smtp();
    const transport = this.transportFor(config);
    const from = mail.from ?? { address: config.fromAddress, name: config.fromName || undefined };
    try {
      const info = await transport.sendMail({
        from: { address: from.address, name: from.name },
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      });
      return { providerMessageId: info.messageId };
    } catch (cause) {
      throw toEmailProviderError(cause);
    }
  }

  /**
   * Connection/auth probe for the health indicator. Cached for 60 s so the
   * health endpoint does not open an SMTP handshake on every scrape.
   */
  async verify(now = Date.now()): Promise<boolean> {
    if (this.verifyCache && now - this.verifyCache.at < 60_000) {
      return this.verifyCache.ok;
    }
    let ok: boolean;
    try {
      const config = await this.credentials.smtp();
      await this.transportFor(config).verify();
      ok = true;
    } catch {
      ok = false;
    }
    this.verifyCache = { at: now, ok };
    return ok;
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      // nodemailer close() is fire-and-forget (void in @types); best effort.
      this.transport?.close();
    } catch {
      // already closed
    }
    this.transport = null;
    this.transportHash = '';
  }

  /** Rebuilds the pooled transport when the settings hash changed. */
  private transportFor(config: SmtpConfig): Transporter {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([config.host, config.port, config.secure, config.user, config.password]),
      )
      .digest('hex');
    if (this.transport && hash === this.transportHash) return this.transport;

    const old = this.transport;
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      pool: true,
      // Mailpit / dev relays run without auth; empty user means anonymous.
      ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
      tls: { rejectUnauthorized: true },
    });
    this.transportHash = hash;
    this.verifyCache = null; // settings changed — force a fresh probe
    try {
      old?.close();
    } catch {
      // previous transport already gone
    }
    return this.transport;
  }
}
