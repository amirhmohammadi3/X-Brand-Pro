// @vitest-environment jsdom
/**
 * SettingsAdmin component tests (F2.4). Covered: grouped rendering with
 * masked secrets, search filtering, the boolean toggle PUTting a boolean
 * value, and the secret write-only flow (empty = keep, clear sends
 * `clear: true`).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { SettingsAdmin } from '../../src/app/[locale]/(admin)/admin/settings/settings-admin';
import { okEnvelope, stubFetch } from '../auth/helpers';
import type { AdminSetting } from '@app/contracts';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin/settings', useRouter: () => ({}) };
});

const OAUTH_ENABLED: AdminSetting = {
  key: 'oauth.google.enabled',
  value: false,
  group: 'integrations',
  isSecret: false,
  isDefault: true,
  updatedAt: null,
};

const SMTP_HOST: AdminSetting = {
  key: 'email.smtp.host',
  value: 'localhost',
  group: 'integrations',
  isSecret: false,
  isDefault: false,
  updatedAt: '2026-11-01T00:00:00Z',
};

const SMTP_PASSWORD: AdminSetting = {
  key: 'email.smtp.password',
  value: 'sup3rs3cret',
  group: 'integrations',
  isSecret: true,
  isDefault: false,
  updatedAt: '2026-11-01T00:00:00Z',
};

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed}>
        <ToastProvider>
          <SettingsAdmin />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function stubSettings(
  handler?: (
    url: string,
    init: RequestInit | undefined,
  ) => { status: number; body: unknown } | undefined,
) {
  stubFetch((url, init) => {
    if (handler) return handler(url, init);
    if (url.includes('/admin/settings')) {
      return {
        status: 200,
        body: okEnvelope({ groups: { integrations: [OAUTH_ENABLED, SMTP_HOST, SMTP_PASSWORD] } }),
      };
    }
    return undefined;
  });
}

describe('SettingsAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders grouped keys with masked secrets and badges', async () => {
    stubSettings();
    renderSettings();
    expect(await screen.findByText('email.smtp.host')).toBeInTheDocument();
    expect(screen.getByText('••••••')).toBeInTheDocument();
    expect(screen.getAllByText('محرمانه').length).toBe(1);
    expect(screen.getAllByText('پیش‌فرض').length).toBe(1);
  });

  it('search filters keys across groups', async () => {
    stubSettings();
    renderSettings();
    await screen.findByText('oauth.google.enabled');
    const search = screen.getByLabelText(/جست‌وجوی کلید/);
    fireEvent.change(search, { target: { value: 'smtp.host' } });
    expect(screen.getByText('email.smtp.host')).toBeInTheDocument();
    expect(screen.queryByText('oauth.google.enabled')).toBeNull();
  });

  it('toggles a boolean setting and PUTs the boolean value', async () => {
    const puts: Array<{ key: string; body: Record<string, unknown> }> = [];
    stubSettings((url, init) => {
      if (url.includes('/admin/settings/oauth.google.enabled') && init?.method === 'PUT') {
        puts.push({ key: 'oauth.google.enabled', body: JSON.parse(String(init.body)) });
        return {
          status: 200,
          body: okEnvelope({ ...OAUTH_ENABLED, value: true, isDefault: false }),
        };
      }
      if (url.includes('/admin/settings')) {
        return {
          status: 200,
          body: okEnvelope({ groups: { integrations: [OAUTH_ENABLED, SMTP_HOST, SMTP_PASSWORD] } }),
        };
      }
      return undefined;
    });
    renderSettings();
    const row = (await screen.findByText('oauth.google.enabled')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /ویرایش/ }));
    const dialog = await screen.findByRole('dialog');
    const switchRole = within(dialog).getByRole('switch');
    fireEvent.click(switchRole);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.body).toEqual({ value: true });
  });

  it('saves a secret write-only and supports clear-override', async () => {
    const puts: Array<{ key: string; body: Record<string, unknown> }> = [];
    stubSettings((url, init) => {
      if (url.includes('/admin/settings/email.smtp.password') && init?.method === 'PUT') {
        puts.push({ key: 'email.smtp.password', body: JSON.parse(String(init.body)) });
        return { status: 200, body: okEnvelope(SMTP_PASSWORD) };
      }
      if (url.includes('/admin/settings')) {
        return {
          status: 200,
          body: okEnvelope({ groups: { integrations: [OAUTH_ENABLED, SMTP_HOST, SMTP_PASSWORD] } }),
        };
      }
      return undefined;
    });
    renderSettings();
    const row = (await screen.findByText('email.smtp.password')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /ویرایش/ }));
    const dialog = await screen.findByRole('dialog');
    // The value input is a password field rendered empty (write-only).
    const input = within(dialog).getByLabelText(/مقدار/) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    // Clear-override switch → `clear: true`
    fireEvent.click(within(dialog).getByRole('switch'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.body).toEqual({ value: '', clear: true });
  });
});
