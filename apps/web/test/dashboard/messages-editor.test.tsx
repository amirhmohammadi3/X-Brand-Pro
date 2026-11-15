// @vitest-environment jsdom
/**
 * F7.6 MessagesEditor — owner dashboard DM inbox shortcut. Covers the
 * rendering paths with `apiFetch` mocked and a real TanStack QueryClientProvider:
 *  - empty inbox renders the empty state;
 *  - a populated inbox renders one conversation row with the peer's name,
 *    the trimmed last-message preview and the unread badge;
 *  - the row links to the existing user-side thread route `/account/messages/:id`
 *    (the dashboard is a jump-in shortcut, NOT a re-host of the thread UI).
 *
 * The full `fa` fallback seed is fed to NextIntlClientProvider so the
 * Persian-digit number formatting (unread count) matches production — the
 * F5.6 inbox test uses the same approach.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConversationCard } from '@app/contracts';
import faSeed from '../../src/i18n/fallback/fa.json';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));

// `@/i18n/navigation`'s Link is a thin wrapper around next/link — stub it as
// an anchor so the rendered href is observable in the jsdom DOM (mirrors the
// F5.6 inbox test stub).
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
    usePathname: () => '/fa/dashboard',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

const { ToastProvider } = await import('../../src/components/ui/toast');

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderWith(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeConversation(overrides: Partial<ConversationCard> = {}): ConversationCard {
  return {
    id: 'c1',
    peer: {
      id: 'u-peer',
      username: 'sara',
      displayName: 'سارا محمدی',
      avatarUrl: null,
    },
    createdAt: '2026-11-10T10:00:00Z',
    lastMessageAt: '2026-11-11T10:00:00Z',
    lastMessage: {
      id: 'm1',
      senderId: 'u-peer',
      bodyPreview: 'سلام، برای رزرو سؤالی داشتم',
      hasAttachment: false,
      createdAt: '2026-11-11T10:00:00Z',
      deleted: false,
    },
    unreadCount: 2,
    ...overrides,
  };
}

const META = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

describe('MessagesEditor (F7.6)', () => {
  beforeEach(() => apiFetchMock.mockReset());
  afterEach(() => cleanup());

  it('renders the empty state when the owner has no conversations', async () => {
    apiFetchMock.mockResolvedValue({
      data: { items: [], meta: { ...META, total: 0, totalPages: 0 } },
    });
    const { MessagesEditor } = await import('../../src/components/dashboard/messages-editor');
    renderWith(<MessagesEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('هنوز گفتگویی ندارید')).toBeTruthy());
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/messaging/conversations',
      expect.anything(),
      expect.anything(),
    );
  });

  it('renders a conversation row linking to /account/messages/:id and showing the unread badge', async () => {
    apiFetchMock.mockResolvedValue({ data: { items: [makeConversation()], meta: META } });
    const { MessagesEditor } = await import('../../src/components/dashboard/messages-editor');
    renderWith(<MessagesEditor businessId="b1" />);

    const row = await screen.findByTestId('dashboard-conversation-row');
    expect(row.getAttribute('href')).toBe('/account/messages/c1');
    expect(row.getAttribute('data-conversation-id')).toBe('c1');
    expect(row.getAttribute('data-unread')).toBe('true');
    expect(screen.getByText('سارا محمدی')).toBeTruthy();
    expect(screen.getByText('سلام، برای رزرو سؤالی داشتم')).toBeTruthy();
    // The unread badge carries the count (Persian-digit rendered, like F5.6).
    expect(screen.getByTestId('dashboard-conversation-unread')).toBeTruthy();
  });

  it('renders a soft-deleted last message as the placeholder, not the body', async () => {
    apiFetchMock.mockResolvedValue({
      data: {
        items: [
          makeConversation({
            lastMessage: {
              id: 'm1',
              senderId: 'u-peer',
              bodyPreview: null,
              hasAttachment: false,
              createdAt: '2026-11-11T10:00:00Z',
              deleted: true,
            },
            unreadCount: 0,
          }),
        ],
        meta: META,
      },
    });
    const { MessagesEditor } = await import('../../src/components/dashboard/messages-editor');
    renderWith(<MessagesEditor businessId="b1" />);
    await screen.findByTestId('dashboard-conversation-row');
    expect(screen.getByText('این پیام حذف شد.')).toBeTruthy();
    // No unread badge when unreadCount is 0.
    expect(screen.queryByTestId('dashboard-conversation-unread')).toBeNull();
  });

  it('renders an attachment-only last message as the attachment marker', async () => {
    apiFetchMock.mockResolvedValue({
      data: {
        items: [
          makeConversation({
            lastMessage: {
              id: 'm1',
              senderId: 'u-peer',
              bodyPreview: null,
              hasAttachment: true,
              createdAt: '2026-11-11T10:00:00Z',
              deleted: false,
            },
          }),
        ],
        meta: META,
      },
    });
    const { MessagesEditor } = await import('../../src/components/dashboard/messages-editor');
    renderWith(<MessagesEditor businessId="b1" />);
    await screen.findByTestId('dashboard-conversation-row');
    expect(screen.getByText('پیوست')).toBeTruthy();
  });
});
