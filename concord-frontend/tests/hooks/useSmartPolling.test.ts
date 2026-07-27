import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useSmartPolling } from '@/hooks/useSmartPolling';

// jitter=0 makes the interval deterministic for the timer-advance assertions
// below; a separate test pins that non-zero jitter actually varies the delay.
const NO_JITTER = { jitter: 0 } as const;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('useSmartPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires immediately on mount by default, then again after each interval', () => {
    const cb = vi.fn();
    renderHook(() => useSmartPolling(cb, 1000, NO_JITTER));

    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does not fire immediately when immediate is false', () => {
    const cb = vi.fn();
    renderHook(() => useSmartPolling(cb, 1000, { ...NO_JITTER, immediate: false }));

    expect(cb).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not poll at all when enabled is false', () => {
    const cb = vi.fn();
    renderHook(() => useSmartPolling(cb, 1000, { ...NO_JITTER, enabled: false }));

    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });

  // ---- Page Visibility pause — the real fix this hook exists for ----------
  it('skips a scheduled tick while the tab is hidden (no wasted background poll)', () => {
    const cb = vi.fn();
    renderHook(() => useSmartPolling(cb, 1000, NO_JITTER));
    expect(cb).toHaveBeenCalledTimes(1); // mount fire

    setVisibility('hidden');
    vi.advanceTimersByTime(1000); // the tick fires the timer, but visibilityState gates the callback
    expect(cb).toHaveBeenCalledTimes(1); // still 1 — the hidden-tab tick was skipped
  });

  it('fires an immediate catch-up poll the moment the tab becomes visible again', () => {
    const cb = vi.fn();
    renderHook(() => useSmartPolling(cb, 1000, NO_JITTER));
    expect(cb).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1); // suppressed while hidden

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).toHaveBeenCalledTimes(2); // real refresh on return, not a stale wait
  });

  it('cleans up its timer and listener on unmount (no leak, no post-unmount calls)', () => {
    const cb = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useSmartPolling(cb, 1000, NO_JITTER));
    const callsAtUnmount = cb.mock.calls.length;

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    vi.advanceTimersByTime(10_000);
    expect(cb).toHaveBeenCalledTimes(callsAtUnmount); // no further calls after unmount
  });

  // ---- Jitter — spreads out components sharing the same POLL_MS constant --
  it('applies jitter within the documented +/-fraction bound, not a fixed interval', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const cb = vi.fn();

    // Math.random() = 1 -> jitter formula's (rand*2-1) term = +1 -> max +10% delay.
    randomSpy.mockReturnValue(1);
    renderHook(() => useSmartPolling(cb, 1000, { jitter: 0.1, immediate: false }));

    vi.advanceTimersByTime(1099);
    expect(cb).toHaveBeenCalledTimes(0); // hasn't fired yet - jittered delay is ~1100ms
    vi.advanceTimersByTime(2);
    expect(cb).toHaveBeenCalledTimes(1); // fires once the jittered delay elapses

    randomSpy.mockRestore();
  });
});
