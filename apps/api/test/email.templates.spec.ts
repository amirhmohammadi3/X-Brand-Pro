import { describe, expect, it } from 'vitest';
import { renderEmail } from '../src/modules/email/templates/index.js';
import { escapeHtml } from '../src/modules/email/templates/escape-html.js';

describe('email templates (B1.6, offline unit)', () => {
  it('escapeHtml neutralises hostile payloads', () => {
    const hostile = '<script>alert("x")</script> & \'quotes\'';
    const safe = escapeHtml(hostile);
    expect(safe).not.toContain('<script>');
    expect(safe).not.toContain('alert("x")');
    expect(safe).toContain('&lt;script&gt;');
    expect(safe).toContain('&quot;');
    expect(safe).toContain('&#39;');
    expect(safe).toContain('&amp;');
  });

  it('renders every template in fa with dir="rtl" and lang="fa"', () => {
    const templates = [
      ['otp', { code: '123456', ttlMin: '2' }],
      ['verify-email', { name: 'امیر', url: 'https://example.com/v?t=abc' }],
      ['reset-password', { name: 'امیر', url: 'https://example.com/r?t=abc' }],
      ['welcome', { name: 'امیر' }],
      ['generic', { title: 'اعلان', body: 'متن آزمایشی' }],
    ] as const;
    for (const [id, vars] of templates) {
      const mail = renderEmail(id, 'fa', { ...vars });
      expect(mail.html).toContain('dir="rtl"');
      expect(mail.html).toContain('lang="fa"');
      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.text.length).toBeGreaterThan(0);
      // table-based 600px layout, inline CSS, brand present
      expect(mail.html).toContain('max-width:600px');
      expect(mail.html).toContain('<table');
      expect(mail.html).toContain('جاباز');
    }
  });

  it('renders every template in en with dir="ltr" and lang="en"', () => {
    const templates = [
      ['otp', { code: '123456', ttlMin: '2' }],
      ['verify-email', { name: 'Amir', url: 'https://example.com/v?t=abc' }],
      ['reset-password', { name: 'Amir', url: 'https://example.com/r?t=abc' }],
      ['welcome', { name: 'Amir' }],
      ['generic', { title: 'Notice', body: 'Test body' }],
    ] as const;
    for (const [id, vars] of templates) {
      const mail = renderEmail(id, 'en', { ...vars });
      expect(mail.html).toContain('dir="ltr"');
      expect(mail.html).toContain('lang="en"');
      expect(mail.html).toContain('Jabaz');
      expect(mail.subject.length).toBeGreaterThan(0);
    }
  });

  it('embeds the otp code in html and text', () => {
    const mail = renderEmail('otp', 'fa', { code: '913254', ttlMin: '2' });
    expect(mail.html).toContain('913254');
    expect(mail.text).toContain('913254');
    expect(mail.text).toContain('دقیقه');
  });

  it('escapes template variables (otp code and generic body)', () => {
    const mail = renderEmail('otp', 'en', { code: '<img src=x onerror=alert(1)>', ttlMin: '2' });
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img');

    const generic = renderEmail('generic', 'en', {
      title: '<script>evil()</script>',
      body: 'line1\nline2 <b>bold</b>',
    });
    expect(generic.html).not.toContain('<script>');
    expect(generic.html).toContain('&lt;script&gt;');
    // newlines in the text body survive as <br> in html
    expect(generic.html).toContain('<br>');
    // the text part is NOT escaped (plain text)
    expect(generic.text).toContain('line2 <b>bold</b>');
  });

  it('falls back for unknown locales: explicit fallbackLocale wins, else en', () => {
    const fa = renderEmail('generic', 'ar', { title: 't', body: 'b' }, 'fa');
    expect(fa.html).toContain('dir="rtl"');
    const en = renderEmail('generic', 'ar', { title: 't', body: 'b' }, 'en');
    expect(en.html).toContain('dir="ltr"');
    const def = renderEmail('generic', 'ar', { title: 't', body: 'b' });
    expect(def.html).toContain('dir="ltr"'); // default fallbackLocale = en
  });

  it('rejects unknown template ids', () => {
    expect(() => renderEmail('nope' as 'generic', 'fa', {})).toThrow(/unknown email template/);
  });
});
