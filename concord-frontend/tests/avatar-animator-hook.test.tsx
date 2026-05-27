// Phase E — useAvatarAnimator hook contract.
//
// Pins: (1) mode persists to localStorage, (2) setMode dispatches the
// change event, (3) requestGait with no worker available returns null
// (legacy-safe fallback), (4) getStats includes the current mode.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

beforeEach(() => {
  // jsdom does not implement Worker — leave it undefined so the hook
  // takes the fallback path (which is exactly the contract we want to
  // pin: no worker → returns null poses gracefully).
  // @ts-expect-error - clearing for tests
  global.Worker = undefined;
  window.localStorage.clear();
});

describe('useAvatarAnimator', () => {
  it('defaults to auto mode when no localStorage value is set', async () => {
    const { useAvatarAnimator } = await import('@/hooks/useAvatarAnimator');
    const { result } = renderHook(() => useAvatarAnimator());
    expect(result.current.mode).toBe('auto');
  });

  it('setMode persists to localStorage and emits the change event', async () => {
    const { useAvatarAnimator } = await import('@/hooks/useAvatarAnimator');
    const handler = vi.fn();
    window.addEventListener('concordia:avatar-compute-mode', handler);
    const { result } = renderHook(() => useAvatarAnimator());
    act(() => { result.current.setMode('main-thread'); });
    expect(window.localStorage.getItem('concordia:avatarCompute')).toBe('main-thread');
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('concordia:avatar-compute-mode', handler);
  });

  it('requestGait returns null when no worker is available', async () => {
    const { useAvatarAnimator } = await import('@/hooks/useAvatarAnimator');
    const { result } = renderHook(() => useAvatarAnimator());
    // Worker construction failed (jsdom has no Worker) — requestGait must
    // gracefully return null instead of throwing.
    const pose = result.current.requestGait('player', {
      speed: 1,
      direction: 0,
      slope: 0,
      load: 0,
      fatigue: 1,
      bodyType: 'average',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: { strideLengthScale: 1, hipSwayAmplitude: 1, armSwingAmplitude: 1 } as any,
    }, 0, 0.016);
    expect(pose).toBeNull();
  });

  it('getStats includes the current mode', async () => {
    const { useAvatarAnimator } = await import('@/hooks/useAvatarAnimator');
    const { result } = renderHook(() => useAvatarAnimator());
    const stats = result.current.getStats();
    expect(stats.mode).toBe('auto');
    expect(stats.samples).toBe(0);
    expect(stats.ready).toBe(false);  // worker never spawned in jsdom
  });
});
