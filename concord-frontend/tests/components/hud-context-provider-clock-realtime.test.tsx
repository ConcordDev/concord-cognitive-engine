/**
 * Wave 4 backlog #15 fix — HUDContextProvider used to open its OWN raw
 * `socket.io-client` connection (`await import('socket.io-client')` + manual
 * `io({...})`) just to hear the server's un-scoped `world:clock` broadcast
 * (server/lib/world-clock.js), instead of using the app-wide shared socket
 * singleton in `lib/realtime/socket.ts`. Root cause: `world:clock` was a real
 * server event missing from the typed `SocketEvent` union, so a developer
 * bypassed `getSocket()`/`subscribe()` rather than extending the union.
 *
 * This test pins two things:
 *   1. No second connection: `socket.io-client`'s `io()` factory is NEVER
 *      called by this component (mounting it must not construct a raw
 *      socket) — the shared `subscribe()` API is used instead.
 *   2. `world:clock` events are still received and processed identically:
 *      the payload's real shape ({ phase, segment, epochMs, dayLengthMs, ts }
 *      per server/lib/world-clock.js#startWorldClockBroadcast) flows through
 *      to the Zustand store's worldPhase/worldDaySegment slice, and the
 *      handler's `cancelled`-flag guard still no-ops after unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ---- Mock the raw socket.io-client factory so we can assert it's never
// invoked by this component. (A leftover raw connection would call `io(...)`.)
const rawIoFactory = vi.fn(() => ({
  on: vi.fn(),
  off: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('socket.io-client', () => ({
  io: rawIoFactory,
}));

// ---- Mock the shared typed socket module (the pattern this component
// should now use) with a tiny in-memory pub/sub so we can fire real
// world:clock payloads and observe cleanup.
type Handler = (data: unknown) => void;
const listeners: Record<string, Handler[]> = {};
const unsubscribeSpies: Record<string, ReturnType<typeof vi.fn>[]> = {};

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn((event: string, cb: Handler) => {
    (listeners[event] ||= []).push(cb);
    const unsub = vi.fn(() => {
      listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
    });
    (unsubscribeSpies[event] ||= []).push(unsub);
    return unsub;
  }),
}));

const emitSocket = (event: string, data: unknown) => {
  (listeners[event] || []).forEach((cb) => cb(data));
};

import { HUDContextProvider, useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';
import { subscribe } from '@/lib/realtime/socket';

// macroCall() hits fetch('/api/lens/run') from several polling effects in
// this component; stub it out so those effects no-op cleanly in jsdom.
beforeEach(() => {
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  Object.keys(unsubscribeSpies).forEach((k) => delete unsubscribeSpies[k]);
  rawIoFactory.mockClear();
  (subscribe as unknown as ReturnType<typeof vi.fn>).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false } as Response))
  );
  // Reset the store's clock slice to its documented default before each test.
  act(() => {
    useHUDContext.setState({ worldPhase: 0.25, worldDaySegment: 'midday' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('HUDContextProvider — world:clock consolidated onto the shared socket', () => {
  it('never constructs a raw socket.io-client connection', () => {
    const { unmount } = render(<HUDContextProvider />);
    expect(rawIoFactory).not.toHaveBeenCalled();
    unmount();
    expect(rawIoFactory).not.toHaveBeenCalled();
  });

  it('subscribes to world:clock via the shared getSocket()/subscribe() API', () => {
    render(<HUDContextProvider />);
    expect(subscribe).toHaveBeenCalledWith('world:clock', expect.any(Function));
    expect(listeners['world:clock']?.length).toBe(1);
  });

  it('processes a real world:clock payload identically to before (phase/segment -> store)', () => {
    render(<HUDContextProvider />);

    act(() => {
      emitSocket('world:clock', {
        phase: 0.72,
        segment: 'dusk',
        epochMs: Date.now(),
        dayLengthMs: 24 * 60 * 1000,
        ts: new Date().toISOString(),
      });
    });

    const state = useHUDContext.getState();
    expect(state.worldPhase).toBeCloseTo(0.72);
    expect(state.worldDaySegment).toBe('dusk');
  });

  it('ignores a malformed payload (no numeric phase) just like before', () => {
    render(<HUDContextProvider />);
    act(() => {
      emitSocket('world:clock', { segment: 'night' });
    });
    // worldPhase must be untouched from the reset default (0.25/midday).
    const state = useHUDContext.getState();
    expect(state.worldPhase).toBe(0.25);
    expect(state.worldDaySegment).toBe('midday');
  });

  it('the tween interval advances phase locally between broadcasts', () => {
    vi.useFakeTimers();
    render(<HUDContextProvider />);
    act(() => {
      emitSocket('world:clock', { phase: 0.1, segment: 'dawn' });
    });
    expect(useHUDContext.getState().worldPhase).toBeCloseTo(0.1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(useHUDContext.getState().worldPhase).toBeGreaterThan(0.1);
  });

  it('unsubscribes from world:clock on unmount and the cancelled-flag guards a race', () => {
    const { unmount } = render(<HUDContextProvider />);
    const registeredCallback = listeners['world:clock']?.[0];
    expect(registeredCallback).toBeTruthy();

    unmount();

    // The real subscribe()'s unsubscribe function should have been invoked.
    expect(unsubscribeSpies['world:clock']?.[0]).toHaveBeenCalled();

    // Even if something still held a reference to the pre-unmount handler
    // and called it post-unmount (the `cancelled` flag guard), the store
    // must not be mutated.
    const before = useHUDContext.getState().worldPhase;
    act(() => {
      registeredCallback?.({ phase: 0.99, segment: 'night' });
    });
    expect(useHUDContext.getState().worldPhase).toBe(before);
  });
});
