import { describe, expect, it } from 'vitest';
import { SmtpDriver } from '../src/modules/email/drivers/smtp.driver.js';
import { renderEmail } from '../src/modules/email/templates/index.js';
import type { EmailCredentialsService } from '../src/modules/email/email-credentials.service.js';

// Env for anything that validates process.env during imports.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';

/**
 * B1.6 integration test: send through the REAL nodemailer SMTP driver to
 * Mailpit (localhost:1025) and read the message back from Mailpit's HTTP API
 * (localhost:8025). Skips automatically when Mailpit is not reachable
 * (`pnpm services:up` on a Docker machine).
 */
async function mailpitReachable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:8025/api/v1/messages', {
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe('SMTP → Mailpit round trip (B1.6, needs Docker services)', () => {
  it('delivers a rendered template and the message shows up in Mailpit', async () => {
    if (!(await mailpitReachable())) {
      // No Docker/Mailpit in this environment — stay green (see db.spec note).
      return;
    }

    const credentials = {
      smtp: async () => ({
        host: 'localhost',
        port: 1025,
        secure: false,
        user: '',
        password: '',
        fromAddress: 'no-reply@localhost',
        fromName: 'X-Brand-Pro Tests',
      }),
      siteLocale: async () => 'fa' as const,
    } as unknown as EmailCredentialsService;
    const driver = new SmtpDriver(credentials);

    const rendered = renderEmail('generic', 'fa', {
      title: 'آزمایش ارسال ایمیل',
      body: 'پیام آزمایشی B1.6',
    });
    const result = await driver.send({
      to: 'recipient@example.com',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    expect(result.providerMessageId).toBeTruthy();

    // Poll Mailpit for up to ~5 s until the message appears.
    let found: { Subject: { Text?: string }; To: Array<{ Address: string }> } | undefined;
    for (let attempt = 0; attempt < 10 && !found; attempt++) {
      const res = await fetch('http://localhost:8025/api/v1/messages');
      const body = (await res.json()) as {
        messages: Array<{
          Subject: { Text?: string };
          To: Array<{ Address: string }>;
        }>;
      };
      found = body.messages.find(
        (m) =>
          m.Subject.Text === 'آزمایش ارسال ایمیل' &&
          m.To.some((t) => t.Address === 'recipient@example.com'),
      );
      if (!found) await new Promise((r) => setTimeout(r, 500));
    }
    expect(found).toBeDefined();
  });
});
