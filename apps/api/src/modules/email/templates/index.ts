import { escapeHtml } from './escape-html.js';
import { layoutEmail, type TemplateLocale } from './layout.js';

/**
 * The five built-in email templates (B1.6) with inline fa/en text. The i18n
 * module does not exist yet — B5.3 later moves notification templates into
 * translatable storage; these stay code-owned until then.
 * Every variable is escaped exactly once, here.
 */

export type EmailTemplateId = 'otp' | 'verify-email' | 'reset-password' | 'welcome' | 'generic';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface TemplateDef {
  render: (locale: TemplateLocale, vars: Record<string, string>) => RenderedEmail;
}

const otp: TemplateDef = {
  render: (locale, vars) => {
    const code = escapeHtml(vars['code'] ?? '');
    const ttlMin = escapeHtml(vars['ttlMin'] ?? '2');
    if (locale === 'fa') {
      const text = `کد تأیید شما: ${vars['code'] ?? ''}\nاین کد ${vars['ttlMin'] ?? '2'} دقیقه اعتبار دارد. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.`;
      return {
        subject: 'کد تأیید شما',
        text,
        html: layoutEmail(
          locale,
          'کد تأیید',
          `<p>کد تأیید شما:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>این کد ${ttlMin} دقیقه اعتبار دارد. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.</p>`,
        ),
      };
    }
    const text = `Your verification code: ${vars['code'] ?? ''}\nIt expires in ${vars['ttlMin'] ?? '2'} minutes. If you did not request it, ignore this message.`;
    return {
      subject: 'Your verification code',
      text,
      html: layoutEmail(
        locale,
        'Verification code',
        `<p>Your verification code:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>It expires in ${ttlMin} minutes. If you did not request it, ignore this message.</p>`,
      ),
    };
  },
};

const verifyEmail: TemplateDef = {
  render: (locale, vars) => {
    const url = escapeHtml(vars['url'] ?? '');
    const name = escapeHtml(vars['name'] ?? '');
    if (locale === 'fa') {
      const text = `${vars['name'] ?? ''} عزیز،\nبرای تأیید نشانی ایمیل خود روی پیوند زیر بزنید:\n${vars['url'] ?? ''}\nاگر شما این درخواست را نداده‌اید، این پیام را نادیده بگیرید.`;
      return {
        subject: 'تأیید نشانی ایمیل',
        text,
        html: layoutEmail(
          locale,
          'تأیید نشانی ایمیل',
          `${name ? `<p>${name} عزیز،</p>` : ''}<p>برای تأیید نشانی ایمیل خود روی دکمهٔ زیر بزنید:</p><p><a href="${url}" style="display:inline-block;padding:10px 20px;background-color:#111827;color:#ffffff;border-radius:6px;text-decoration:none;">تأیید ایمیل</a></p><p style="color:#6b7280;font-size:12px;">اگر دکمه کار نکرد، این نشانی را در مرورگر باز کنید: ${url}</p>`,
        ),
      };
    }
    const text = `Hi ${vars['name'] ?? ''},\nConfirm your email address by opening the link below:\n${vars['url'] ?? ''}\nIf you did not request this, ignore this message.`;
    return {
      subject: 'Confirm your email address',
      text,
      html: layoutEmail(
        locale,
        'Confirm your email address',
        `${name ? `<p>Hi ${name},</p>` : ''}<p>Confirm your email address by clicking the button below:</p><p><a href="${url}" style="display:inline-block;padding:10px 20px;background-color:#111827;color:#ffffff;border-radius:6px;text-decoration:none;">Verify email</a></p><p style="color:#6b7280;font-size:12px;">If the button does not work, open this address in your browser: ${url}</p>`,
      ),
    };
  },
};

const resetPassword: TemplateDef = {
  render: (locale, vars) => {
    const url = escapeHtml(vars['url'] ?? '');
    const name = escapeHtml(vars['name'] ?? '');
    if (locale === 'fa') {
      const text = `${vars['name'] ?? ''} عزیز،\nبرای بازنشانی رمز عبور روی پیوند زیر بزنید:\n${vars['url'] ?? ''}\nاگر شما این درخواست را نداده‌اید، رمز خود را تغییر دهید.`;
      return {
        subject: 'بازنشانی رمز عبور',
        text,
        html: layoutEmail(
          locale,
          'بازنشانی رمز عبور',
          `${name ? `<p>${name} عزیز،</p>` : ''}<p>برای انتخاب رمز تازه روی دکمهٔ زیر بزنید:</p><p><a href="${url}" style="display:inline-block;padding:10px 20px;background-color:#111827;color:#ffffff;border-radius:6px;text-decoration:none;">بازنشانی رمز</a></p><p style="color:#6b7280;font-size:12px;">اگر شما درخواست نداده‌اید، رمز خود را تغییر دهید.</p>`,
        ),
      };
    }
    const text = `Hi ${vars['name'] ?? ''},\nReset your password by opening the link below:\n${vars['url'] ?? ''}\nIf you did not request this, change your password.`;
    return {
      subject: 'Reset your password',
      text,
      html: layoutEmail(
        locale,
        'Reset your password',
        `${name ? `<p>Hi ${name},</p>` : ''}<p>Choose a new password using the button below:</p><p><a href="${url}" style="display:inline-block;padding:10px 20px;background-color:#111827;color:#ffffff;border-radius:6px;text-decoration:none;">Reset password</a></p><p style="color:#6b7280;font-size:12px;">If you did not request this, change your password.</p>`,
      ),
    };
  },
};

const welcome: TemplateDef = {
  render: (locale, vars) => {
    const name = escapeHtml(vars['name'] ?? '');
    if (locale === 'fa') {
      const text = `${vars['name'] ?? ''} عزیز، خوش آمدید!\nحساب شما ساخته شد. امیدواریم از استفاده لذت ببرید.`;
      return {
        subject: 'به ما خوش آمدید',
        text,
        html: layoutEmail(
          locale,
          'خوش آمدید 👋',
          `${name ? `<p>${name} عزیز،</p>` : ''}<p>حساب شما با موفقیت ساخته شد. امیدواریم از استفاده لذت ببرید!</p>`,
        ),
      };
    }
    const text = `Hi ${vars['name'] ?? ''},\nWelcome aboard! Your account is ready — enjoy.`;
    return {
      subject: 'Welcome aboard',
      text,
      html: layoutEmail(
        locale,
        'Welcome 👋',
        `${name ? `<p>Hi ${name},</p>` : ''}<p>Your account is ready. Enjoy!</p>`,
      ),
    };
  },
};

const generic: TemplateDef = {
  render: (locale, vars) => {
    const title = escapeHtml(vars['title'] ?? '');
    // Plain text body: newlines survive as text; in HTML they become <br>.
    const bodyText = vars['body'] ?? '';
    const bodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br>');
    if (locale === 'fa') {
      return {
        subject: title || 'پیام',
        text: bodyText,
        html: layoutEmail(locale, title || 'پیام', `<p>${bodyHtml}</p>`),
      };
    }
    return {
      subject: title || 'Message',
      text: bodyText,
      html: layoutEmail(locale, title || 'Message', `<p>${bodyHtml}</p>`),
    };
  },
};

const TEMPLATES: Record<EmailTemplateId, TemplateDef> = {
  otp,
  'verify-email': verifyEmail,
  'reset-password': resetPassword,
  welcome,
  generic,
};

/**
 * Renders a template for a locale. Unknown locales fall back to
 * `fallbackLocale` (the site default is passed by EmailService), then —
 * because every template ships fa AND en — `en` always exists as the last
 * resort via FALLBACK_LOCALE.
 */
export function renderEmail(
  templateId: EmailTemplateId,
  locale: string,
  vars: Record<string, string>,
  fallbackLocale: TemplateLocale = 'en',
): RenderedEmail {
  const template = TEMPLATES[templateId];
  if (!template) throw new Error(`unknown email template "${templateId}"`);
  const resolved: TemplateLocale =
    locale === 'fa' || locale === 'en' ? locale : fallbackLocale === 'fa' ? 'fa' : 'en';
  return template.render(resolved, vars);
}
