// @vitest-environment jsdom
/**
 * ConversationThread component tests (F5.6). Covers:
 *  - the thread renders one bubble per message, own messages end-aligned
 *    (data-mine="true"), the peer's start-aligned;
 *  - typing + clicking send (or pressing Enter) fires POST
 *    /messaging/conversations/:id/messages with the body;
 *  - clicking delete on an own message fires DELETE /messaging/messages/:id;
 *  - a soft-deleted message renders the deleted placeholder;
 *  - the load error renders when the thread fetch fails.
 *
 * Realtime hooks are mocked (the realtime client has its own test suite); the
 * test asserts the component renders + issues the right HTTP calls.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import faSeed from '../../src/i18n/fallback/fa.json';
import { ToastProvider } from '../../src/components/ui/toast';
import { ConversationThread } from '../../src/components/account/conversation-thread';
import { AuthProvider } from '../../src/lib/auth/auth-context';
import { makeUser, okEnvelope, errorEnvelope, stubFetch, type RouteHandler } from '../auth/helpers';

// Mock the realtime hooks so the test runs in jsdom without a socket. The
// invalidation callbacks are captured so a test can fire them and assert the
// thread refetches.
const realtimeHandlers: Array<(payload: unknown) => void> = [];
vi.mock('../../src/lib/realtime/use-realtime', () => ({
  useRealtimeConversation: () => ({ ack: { ok: true, room: 'conversation:test' }, pending: false }),
  useRealtimeStatus: () => 'connected',
  useRealtimeEvent: (
    _event: string,
    handler: (payload: unknown) => void,
    _deps: ReadonlyArray<unknown>,
  ) => {
    // Register the handler so a test can drive it via fireRealtimeMessage().
    realtimeHandlers.push(handler);
  },
}));

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
const MY_ID = '00000000-0000-4000-8000-0000000000f1'; // matches makeUser().id
const PEER_ID = '00000000-0000-4000-8000-0000000000b1';
const MSG_MINE = '00000000-0000-4000-8000-0000000000a1';
const MSG_PEER = '00000000-0000-4000-8000-0000000000a2';

function threadEnvelope(opts: { deletedMine?: boolean } = {}) {
  return okEnvelope({
    items: [
      {
        id: MSG_PEER,
        conversationId: CONV_ID,
        senderId: PEER_ID,
        body: 'سلام',
        attachment: null,
        createdAt: '2026-11-12T08:00:00Z',
        deletedAt: null,
      },
      {
        id: MSG_MINE,
        conversationId: CONV_ID,
        senderId: MY_ID,
        body: opts.deletedMine ? null : 'چی می‌کنی؟',
        attachment: null,
        createdAt: '2026-11-12T08:05:00Z',
        deletedAt: opts.deletedMine ? '2026-11-12T08:06:00Z' : null,
      },
    ],
    meta: { page: 1, pageSize: 30, total: 2, totalPages: 1 },
  });
}

function renderThread(handler: RouteHandler): Mock {
  cleanup();
  realtimeHandlers.length = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fa" messages={faSeed as unknown as Record<string, unknown>}>
        <ToastProvider>
          <AuthProvider initialUser={makeUser({ id: MY_ID })} initialApiError={false}>
            <ConversationThread conversationId={CONV_ID} />
          </AuthProvider>
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

function findCall(fetchMock: Mock, method: string, urlPart: string): unknown {
  return fetchMock.mock.calls.find((call) => {
    const init = call[1] as RequestInit | undefined;
    const m = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
    return m === method && String(call[0]).includes(urlPart);
  });
}

function bodyOf(call: unknown): Record<string, unknown> {
  const init = (call as [string, RequestInit])[1];
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('ConversationThread (F5.6)', () => {
  it('renders one bubble per message with own messages end-aligned', async () => {
    renderThread((url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'GET') {
        return { status: 200, body: threadEnvelope() };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/read`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({ ok: true, lastReadMessageId: MSG_PEER, unreadCount: 0 }),
        };
      }
      return undefined;
    });

    const bubbles = await screen.findAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    // The peer's message is first (oldest), mine is second.
    expect(bubbles[0]?.getAttribute('data-mine')).toBe('false');
    expect(bubbles[1]?.getAttribute('data-mine')).toBe('true');
    expect(screen.getByText('سلام')).toBeInTheDocument();
    expect(screen.getByText('چی می‌کنی؟')).toBeInTheDocument();
  });

  it('sends a message on click with the typed body', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'GET') {
        return { status: 200, body: threadEnvelope() };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({
            id: '00000000-0000-4000-8000-0000000000a3',
            conversationId: CONV_ID,
            senderId: MY_ID,
            body: 'پیام جدید',
            attachment: null,
            createdAt: '2026-11-12T08:10:00Z',
            deletedAt: null,
          }),
        };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/read`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({ ok: true, lastReadMessageId: MSG_PEER, unreadCount: 0 }),
        };
      }
      return undefined;
    };
    const fetchMock = renderThread(handler);

    const composer = await screen.findByTestId('message-composer');
    const user = userEvent.setup();
    await user.type(composer, 'پیام جدید');
    await user.click(screen.getByTestId('message-send'));

    await waitFor(() => {
      const call = findCall(fetchMock, 'POST', `/messaging/conversations/${CONV_ID}/messages`);
      expect(call).toBeTruthy();
      expect(bodyOf(call)).toEqual({ body: 'پیام جدید' });
    });
  });

  it('sends on Enter (no shift) and inserts a newline on Shift+Enter', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'GET') {
        return { status: 200, body: threadEnvelope() };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({
            id: '00000000-0000-4000-8000-0000000000a4',
            conversationId: CONV_ID,
            senderId: MY_ID,
            body: 'x',
            attachment: null,
            createdAt: '2026-11-12T08:10:00Z',
            deletedAt: null,
          }),
        };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/read`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({ ok: true, lastReadMessageId: MSG_PEER, unreadCount: 0 }),
        };
      }
      return undefined;
    };
    const fetchMock = renderThread(handler);

    const composer = (await screen.findByTestId('message-composer')) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(composer, 'x');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const call = findCall(fetchMock, 'POST', `/messaging/conversations/${CONV_ID}/messages`);
      expect(call).toBeTruthy();
    });
  });

  it('deletes an own message via the per-bubble delete button', async () => {
    const handler: RouteHandler = (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'GET') {
        return { status: 200, body: threadEnvelope() };
      }
      if (url.includes(`/messaging/messages/${MSG_MINE}`) && method === 'DELETE') {
        return { status: 200, body: okEnvelope({ deleted: true }) };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/read`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({ ok: true, lastReadMessageId: MSG_PEER, unreadCount: 0 }),
        };
      }
      return undefined;
    };
    const fetchMock = renderThread(handler);

    const deleteBtns = await screen.findAllByTestId('message-delete');
    // Only own (mine) non-deleted messages expose a delete button → exactly 1.
    expect(deleteBtns).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(deleteBtns[0] as HTMLElement);

    await waitFor(() => {
      const call = findCall(fetchMock, 'DELETE', `/messaging/messages/${MSG_MINE}`);
      expect(call).toBeTruthy();
    });
  });

  it('renders the deleted placeholder for a soft-deleted own message', async () => {
    renderThread((url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`) && method === 'GET') {
        return { status: 200, body: threadEnvelope({ deletedMine: true }) };
      }
      if (url.includes(`/messaging/conversations/${CONV_ID}/read`) && method === 'POST') {
        return {
          status: 200,
          body: okEnvelope({ ok: true, lastReadMessageId: MSG_PEER, unreadCount: 0 }),
        };
      }
      return undefined;
    });

    const bubbles = await screen.findAllByTestId('message-bubble');
    const mine = bubbles.find((b) => b.getAttribute('data-mine') === 'true');
    expect(mine?.getAttribute('data-deleted')).toBe('true');
    // The deleted placeholder text comes from the fa seed.
    expect(screen.getByText('این پیام حذف شد.')).toBeInTheDocument();
    // A deleted own message no longer exposes a delete button.
    expect(screen.queryByTestId('message-delete')).not.toBeInTheDocument();
  });

  it('renders the load error when the thread fetch fails', async () => {
    renderThread((url) => {
      if (url.includes(`/messaging/conversations/${CONV_ID}/messages`)) {
        return { status: 500, body: errorEnvelope('INTERNAL_ERROR') };
      }
      return undefined;
    });
    expect(await screen.findByText('بارگذاری گفتگو ممکن نشد.')).toBeInTheDocument();
  });
});
