import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit F10 — honest disconnect grace-period reset.
//
// Proves the grace-period logic in lib/realtime/socket.ts:
//   (a) disconnect → reconnect WITHIN the grace period → the connection-lost
//       listener is NEVER called (transient blip, in-flight work preserved);
//   (b) disconnect → grace period elapses with no reconnect → the listener IS
//       called exactly once ("kill the server mid-run → all motion stops");
//   (c) repeated disconnect/reconnect (and repeated disconnects) never stack
//       pending timers or fire the listener more than once (cancel-and-restart).
//
// Timers are mocked (vi.useFakeTimers) so nothing waits on a real 6s delay.

const mockSocketInstance = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  id: 'test-socket-id',
  auth: {} as Record<string, unknown>,
  // lib/realtime/socket.ts registers reconnect-attempt diagnostics on the
  // underlying Manager instance (`socket.io.on('reconnect_attempt', ...)`),
  // not on the socket itself — real socket.io-client sockets always carry
  // this. Without it here, getSocket() throws on the `.io.on` call.
  io: {
    on: vi.fn(),
    off: vi.fn(),
  },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocketInstance),
}));

// Mirror the offline-db clock-sync mock the sibling socket test uses. The
// grace-period paths under test never touch it, but keep the mock so no real
// IndexedDB access can leak in.
vi.mock('../offline/db', () => ({
  updateClockOffset: vi.fn(),
}));

let socketModule: typeof import('@/lib/realtime/socket');

// The grace-period timer is CONNECTION_LOST_GRACE_MS (6000) in the source. Use
// a value comfortably past it for the "elapsed" advances.
const GRACE_MS = 6000;
const PAST_GRACE = GRACE_MS + 100;
const WITHIN_GRACE = 1000;

function handlerFor(name: string): ((...args: unknown[]) => void) | undefined {
  const call = mockSocketInstance.on.mock.calls.find((c: unknown[]) => c[0] === name);
  return call?.[1] as ((...args: unknown[]) => void) | undefined;
}

describe('socket connection-lost grace period', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSocketInstance.connected = false;
    vi.resetModules();
    vi.useFakeTimers();
    socketModule = await import('@/lib/realtime/socket');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) reconnect WITHIN the grace period never fires the connection-lost listener', () => {
    socketModule.getSocket(); // register lifecycle handlers
    const onLost = vi.fn();
    socketModule.onConnectionLost(onLost);

    const disconnect = handlerFor('disconnect');
    const connect = handlerFor('connect');
    expect(disconnect).toBeTypeOf('function');
    expect(connect).toBeTypeOf('function');

    // Backend drops...
    disconnect!('transport close');
    // ...but reconnects before the grace period elapses.
    vi.advanceTimersByTime(WITHIN_GRACE);
    connect!();

    // Let plenty of time pass to prove the timer was truly cancelled.
    vi.advanceTimersByTime(PAST_GRACE * 2);

    expect(onLost).not.toHaveBeenCalled();
  });

  it('(b) grace period elapsing with no reconnect fires the listener exactly once', () => {
    socketModule.getSocket();
    const onLost = vi.fn();
    socketModule.onConnectionLost(onLost);

    handlerFor('disconnect')!('io server disconnect');

    // Not yet — still inside the grace window.
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(onLost).not.toHaveBeenCalled();

    // Cross the threshold — the backend is confirmed gone.
    vi.advanceTimersByTime(2);
    expect(onLost).toHaveBeenCalledTimes(1);

    // No further fires from the same lapse.
    vi.advanceTimersByTime(PAST_GRACE * 3);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('(c) repeated blips cancel-and-restart — no timer stacking, at most one fire', () => {
    socketModule.getSocket();
    const onLost = vi.fn();
    socketModule.onConnectionLost(onLost);

    const disconnect = handlerFor('disconnect')!;
    const connect = handlerFor('connect')!;

    // Three quick blips, each resolved by a reconnect within grace.
    for (let i = 0; i < 3; i++) {
      disconnect('transport close');
      vi.advanceTimersByTime(WITHIN_GRACE);
      connect();
    }
    vi.advanceTimersByTime(PAST_GRACE);
    expect(onLost).not.toHaveBeenCalled();

    // Repeated disconnects WITHOUT reconnect must not queue multiple fires —
    // the last one's timer should be the only live one.
    disconnect('transport close');
    vi.advanceTimersByTime(2000);
    disconnect('transport close');
    vi.advanceTimersByTime(2000);
    disconnect('transport close');
    // Now let the (single, most-recent) timer elapse.
    vi.advanceTimersByTime(PAST_GRACE);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('a real death then reconnect fires connection-lost once, then reconnected', () => {
    socketModule.getSocket();
    const onLost = vi.fn();
    const onBack = vi.fn();
    socketModule.onConnectionLost(onLost);
    socketModule.onReconnected(onBack);

    const disconnect = handlerFor('disconnect')!;
    const connect = handlerFor('connect')!;

    disconnect('io server disconnect');
    vi.advanceTimersByTime(PAST_GRACE);
    expect(onLost).toHaveBeenCalledTimes(1);

    // Backend comes back later — reconnected listener fires so the UI can clear
    // its "connection lost" state.
    connect();
    expect(onBack).toHaveBeenCalledTimes(1);
    // No spurious extra connection-lost fire.
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing removes the listener before the grace period elapses', () => {
    socketModule.getSocket();
    const onLost = vi.fn();
    const off = socketModule.onConnectionLost(onLost);

    handlerFor('disconnect')!('transport close');
    off(); // unsubscribe mid-grace
    vi.advanceTimersByTime(PAST_GRACE);

    expect(onLost).not.toHaveBeenCalled();
  });

  it('a listener that throws does not break the socket lifecycle', () => {
    socketModule.getSocket();
    const boom = vi.fn(() => {
      throw new Error('listener blew up');
    });
    const good = vi.fn();
    socketModule.onConnectionLost(boom);
    socketModule.onConnectionLost(good);

    handlerFor('disconnect')!('io server disconnect');
    expect(() => vi.advanceTimersByTime(PAST_GRACE)).not.toThrow();
    // The throwing listener didn't stop the other from running.
    expect(good).toHaveBeenCalledTimes(1);
  });
});
