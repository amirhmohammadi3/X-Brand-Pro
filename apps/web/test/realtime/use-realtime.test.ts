// @vitest-environment jsdom
/**
 * Realtime client + hooks tests (F5.5). Covers:
 *  - the singleton is created lazily and ref-counted (acquire/release keeps
 *    the socket alive while at least one subscriber is mounted; the last
 *    release tears it down);
 *  - `useRealtimeStatus` reflects connect / reconnect / disconnect transitions;
 *  - `useRealtimeEvent` registers a handler that fires on the corresponding
 *    server→client event and is removed on unmount;
 *  - `useRealtimeRoom` emits `room:join` on mount and `room:leave` on unmount,
 *    and surfaces the parsed ack.
 *
 * socket.io-client is mocked with an EventEmitter-backed fake so we can drive
 * connect / event / disconnect without a network.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { EventEmitter } from 'events';

// A fresh fake socket per test; the mock factory closes over `current`. The
// definite-assignment assertion is safe: `beforeEach` (and the io() factory)
// assign `current` before any test reads it.
let current!: FakeSocket;

class FakeSocket extends EventEmitter {
  io = new EventEmitter();
  connected = false;
  active = false;
  emits: Array<{ event: string; args: unknown[] }> = [];
  connect(): this {
    this.active = true;
    // Defer connect to the next microtask so listeners can attach first.
    setTimeout(() => {
      this.connected = true;
      this.__fire('connect');
    }, 0);
    return this;
  }
  disconnect(): this {
    this.connected = false;
    this.active = false;
    this.__fire('disconnect', 'client disconnect');
    return this;
  }
  /**
   * Client→server emit: records the call (so tests can assert room:join was
   * sent) but does NOT fire local listeners — matching real Socket.IO where
   * `socket.emit(event, ...)` is a send-to-server, not a local dispatch.
   * Returns `true` to satisfy EventEmitter's `emit` contract.
   */
  override emit(event: string, ...args: unknown[]): boolean {
    this.emits.push({ event, args });
    return true;
  }
  /**
   * Server→client dispatch: fires the local listeners registered with `.on`
   * or `.once`. Tests call this to simulate the gateway pushing an event.
   */
  __fire(event: string, ...args: unknown[]): this {
    super.emit(event, ...args);
    return this;
  }
  /** Socket.IO's `off(event)` with no listener removes ALL listeners. */
  override off(event: string, listener?: (...args: unknown[]) => void): this {
    if (listener) super.off(event, listener);
    else this.removeAllListeners(event);
    return this;
  }
}

vi.mock('socket.io-client', () => ({
  io: (_url: string, _opts: unknown) => {
    current = new FakeSocket();
    return current;
  },
}));

import {
  acquireRealtime,
  releaseRealtime,
  subscribeRealtimeStatus,
  __resetRealtimeForTest,
  joinRoom,
  leaveRoom,
} from '../../src/lib/realtime/realtime-client';
import {
  useRealtimeStatus,
  useRealtimeEvent,
  useRealtimeRoom,
} from '../../src/lib/realtime/use-realtime';
import { REALTIME_EVENTS, realtimeConversationRoom } from '@app/contracts';

beforeEach(() => {
  __resetRealtimeForTest();
  current = new FakeSocket();
});

afterEach(() => {
  __resetRealtimeForTest();
  cleanup();
});

describe('realtime-client singleton (F5.5)', () => {
  it('creates the socket lazily on first acquire and reuses it', () => {
    const a = acquireRealtime();
    const b = acquireRealtime();
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('tears down when the last subscriber releases', () => {
    const s = acquireRealtime();
    expect(s).not.toBeNull();
    releaseRealtime();
    // After teardown, a fresh acquire must create a NEW socket.
    const s2 = acquireRealtime();
    expect(s2).not.toBe(s);
    releaseRealtime();
  });

  it('reports status transitions to subscribers', () => {
    const seen: string[] = [];
    const s = acquireRealtime() as unknown as FakeSocket;
    const unsub = subscribeRealtimeStatus((st) => seen.push(st));
    // connecting is set on acquire; fire connect (server→client).
    s!.__fire('connect');
    expect(seen).toContain('connected');
    unsub();
    releaseRealtime();
  });
});

describe('useRealtimeStatus (F5.5)', () => {
  it('reflects the connection status', () => {
    acquireRealtime(); // creates the socket + sets lastStatus='connecting'
    const { result, unmount } = renderHook(() => useRealtimeStatus());
    expect(result.current).toBe('connecting');
    act(() => current.__fire('connect'));
    expect(result.current).toBe('connected');
    unmount();
    releaseRealtime();
  });
});

describe('useRealtimeEvent (F5.5)', () => {
  it('invokes the handler when the server pushes the event', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useRealtimeEvent(REALTIME_EVENTS.notification, handler, []),
    );
    // Connect so listeners are active (server→client connect dispatch).
    act(() => current.__fire('connect'));
    act(() => current.__fire(REALTIME_EVENTS.notification, { eventKey: 'follow.created' }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ eventKey: 'follow.created' });
    unmount();
  });

  it('does not fire after unmount (handler removed, socket released)', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useRealtimeEvent(REALTIME_EVENTS.notification, handler, []),
    );
    act(() => current.__fire('connect'));
    unmount();
    act(() => current.__fire(REALTIME_EVENTS.notification, {}));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('useRealtimeRoom (F5.5)', () => {
  it('emits room:join on mount and room:leave on unmount', async () => {
    const room = realtimeConversationRoom('00000000-0000-4000-8000-0000000000c1');
    const { result, unmount } = renderHook(() => useRealtimeRoom(room));
    // Not connected yet → hook waits for connect.
    expect(result.current.pending).toBe(true);
    act(() => current.__fire('connect'));

    // The join emit was sent; the ack callback is the 2nd arg.
    await vi.waitFor(() => {
      const join = current.emits.find((e) => e.event === 'room:join');
      expect(join).toBeTruthy();
    });
    const joinCall = current.emits.find((e) => e.event === 'room:join')!;
    const ackCb = joinCall.args[1] as (ack: unknown) => void;
    // `await act(async ...)` flushes the microtask queue so doJoin's
    // continuation (setAck + setPending) has run before we assert.
    await act(async () => {
      ackCb({ ok: true, room });
    });
    expect(result.current.ack).toEqual({ ok: true, room });
    expect(result.current.pending).toBe(false);

    unmount();
    const leave = current.emits.find((e) => e.event === 'room:leave');
    expect(leave).toBeTruthy();
  });

  it('is a no-op when room is null', () => {
    const { result, unmount } = renderHook(() => useRealtimeRoom(null));
    expect(result.current.pending).toBe(false);
    expect(result.current.ack).toBeNull();
    unmount();
  });
});

describe('joinRoom / leaveRoom (F5.5)', () => {
  it('joinRoom resolves with the parsed ack', async () => {
    const s = acquireRealtime()!;
    const promise = joinRoom(s, 'conversation:00000000-0000-4000-8000-0000000000c2');
    const joinCall = (s as unknown as FakeSocket).emits.find((e) => e.event === 'room:join')!;
    const ackCb = joinCall.args[1] as (ack: unknown) => void;
    ackCb({ ok: true, room: 'conversation:00000000-0000-4000-8000-0000000000c2' });
    const ack = await promise;
    expect(ack.ok).toBe(true);
    releaseRealtime();
  });

  it('leaveRoom emits the leave event', () => {
    const s = acquireRealtime()!;
    leaveRoom(s, 'conversation:00000000-0000-4000-8000-0000000000c3');
    const leave = (s as unknown as FakeSocket).emits.find((e) => e.event === 'room:leave');
    expect(leave).toBeTruthy();
    releaseRealtime();
  });
});
