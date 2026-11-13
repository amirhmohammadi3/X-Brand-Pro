// @vitest-environment jsdom
/**
 * MessagingInbox component tests (F5.6). Covers:
 *  - the inbox renders one row per conversation (peer name, preview,
 *    relative time, unread badge) and each row links to
 *    /account/messages/<id>;
 *  - the empty state renders when the inbox is empty;
 *  - the load error renders when the inbox fetch fails.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import faSeed from '../../src/i18n/fallback/fa.json';
import { MessagingInbox } from '../../src/components/account/messaging-inbox';
import { okEnvelope, errorEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return {
    Link,
    usePathname: () => '/fa/account/messages',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const CONV_ID = '00000000-0000-4000-8000-0000000000c1';

const inboxEnvelope = okEnvelope({
  items: [
    {
      id: CONV_ID,
      peer: {
        id: '00000000-0000-4000-8000-0000000000b1',
        username: 'sara',
        displayName: 'سارا محمدی',
        avatarUrl: null,
      },
      createdAt: '2026-11-12T08:00:00Z',
      lastMessageAt: '2026-11-12T09:00:00Z',
      lastMessage: {
        id: '00000000-0000-4000-8000-0000000000a1',
        senderId: '00000000-0000-4000-8000-0000000000b1',
        bodyPreview: 'سلام، وقت خوبی؟',
        hasAttachment: false,
        createdAt: '2026-11-12T09:00:00Z',
        deleted: false,
      },
      unreadCount: 2,
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
});

function renderInbox(handler: RouteHandler): void {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <MessagingInbox />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('MessagingInbox (F5.6)', () => {
  it('renders one row per conversation with peer name, preview and unread badge', async () => {
    renderInbox((url) => {
      if (url.includes('/messaging/conversations')) return { status: 200, body: inboxEnvelope };
      return undefined;
    });

    const rows = await screen.findAllByTestId('conversation-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByText('سارا محمدی')).toBeInTheDocument();
    expect(screen.getByText('سلام، وقت خوبی؟')).toBeInTheDocument();
    // The unread badge carries the count (Persian-digit rendered).
    expect(screen.getByTestId('conversation-unread')).toBeInTheDocument();
    // The row links to the conversation page.
    expect(rows[0]?.getAttribute('href')).toContain(`/account/messages/${CONV_ID}`);
  });

  it('renders the empty state when the inbox is empty', async () => {
    renderInbox((url) => {
      if (url.includes('/messaging/conversations')) {
        return {
          status: 200,
          body: okEnvelope({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
        };
      }
      return undefined;
    });
    expect(await screen.findByText('هنوز گفتگویی ندارید')).toBeInTheDocument();
  });

  it('renders the load error when the inbox fetch fails', async () => {
    renderInbox((url) => {
      if (url.includes('/messaging/conversations')) {
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      }
      return undefined;
    });
    expect(await screen.findByText('بارگذاری گفتگوها ممکن نشد.')).toBeInTheDocument();
  });
});
