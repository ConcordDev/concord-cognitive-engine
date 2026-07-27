import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('useRealtimeRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires refresh once immediately on mount by default', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created'], refresh));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not fire immediately when immediate: false, but still subscribes', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created'], refresh, { immediate: false }));
    expect(refresh).toHaveBeenCalledTimes(0);

    emitSocket('dtu:created');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('fires refresh instantly on a subscribed socket event (push)', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created', 'dtu:updated'], refresh));
    expect(refresh).toHaveBeenCalledTimes(1); // mount

    emitSocket('dtu:updated');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('fires the backstop poll once backstopMs elapses, exactly once (not double-counted with the immediate fire)', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created'], refresh, { backstopMs: 5000 }));
    expect(refresh).toHaveBeenCalledTimes(1); // mount-immediate only

    // The backstop poll is jittered +/-10% (useSmartPolling's default), so
    // advance past the maximum possible jittered delay (5000 * 1.1) rather
    // than exactly 5000ms to avoid a flaky boundary.
    vi.advanceTimersByTime(5500);
    expect(refresh).toHaveBeenCalledTimes(2); // one backstop tick, not two
  });

  it('backstop poll inherits visibility pausing — no wasted refresh while the tab is hidden', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created'], refresh, { backstopMs: 5000 }));
    expect(refresh).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(1); // backstop tick suppressed while hidden
  });

  it('disables both push and backstop when enabled is false', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created'], refresh, { enabled: false, backstopMs: 1000 }));
    expect(refresh).toHaveBeenCalledTimes(0);

    emitSocket('dtu:created');
    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(0);
  });

  it('disables only the backstop when backstopMs is 0, push still works', () => {
    const refresh = vi.fn();
    renderHook(() => useRealtimeRefresh(['dtu:created'], refresh, { backstopMs: 0 }));
    expect(refresh).toHaveBeenCalledTimes(1); // mount

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1); // no backstop tick ever

    emitSocket('dtu:created');
    expect(refresh).toHaveBeenCalledTimes(2); // push still live
  });

  it('unsubscribes and stops the backstop on unmount', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useRealtimeRefresh(['dtu:created'], refresh, { backstopMs: 1000 }));
    unmount();

    emitSocket('dtu:created');
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1); // only the pre-unmount immediate fire
  });
});
