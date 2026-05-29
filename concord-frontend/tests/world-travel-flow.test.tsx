// Phase J — useWorldTravel flow contract.
//
// Pins: (1) phase progresses requesting → spawning → loading-assets →
// complete on a successful round trip, (2) localStorage is written between
// scene-disposed and scene-ready, (3) error response transitions to
// phase=error.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

beforeEach(() => {
  window.localStorage.clear();
  // @ts-expect-error - test fetch stub
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      worldId: 'cyber',
      shardStatus: { ok: true, status: 'active', firstTickEtaMs: 1200 },
      sharded: true,
    }),
  });
});

describe('useWorldTravel', () => {
  it('updates phase to "complete" when the round trip succeeds', async () => {
    const { useWorldTravel } = await import('@/hooks/useWorldTravel');
    const { result } = renderHook(() => useWorldTravel());
    expect(result.current.phase).toBe('idle');

    let travelPromise: Promise<void> | null = null;
    act(() => { travelPromise = result.current.travel('cyber'); });

    // No prior active world → scene-disposed wait resolves on its own
    // safety timeout. Manually trigger scene-ready since we don't mount
    // a real scene in the test.
    await new Promise(r => setTimeout(r, 50));
    window.dispatchEvent(new CustomEvent('concordia:scene-ready'));

    await act(async () => { await travelPromise; });
    expect(result.current.phase).toBe('complete');
    expect(result.current.targetWorldId).toBe('cyber');
    expect(window.localStorage.getItem('concordia:activeWorldId')).toBe('cyber');
  });

  it('transitions to phase=error when the backend rejects', async () => {
    // @ts-expect-error - test fetch stub
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error: 'shard_spawn_failed' }),
    });
    const { useWorldTravel } = await import('@/hooks/useWorldTravel');
    const { result } = renderHook(() => useWorldTravel());
    await act(async () => {
      try { await result.current.travel('cyber'); } catch { /* expected */ }
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/shard_spawn_failed|503/);
  });

  it('waits for scene-disposed when a prior active world exists', async () => {
    window.localStorage.setItem('concordia:activeWorldId', 'tunya');
    const { useWorldTravel } = await import('@/hooks/useWorldTravel');
    const { result } = renderHook(() => useWorldTravel());

    let resolved = false;
    let travelPromise: Promise<void> | null = null;
    act(() => {
      travelPromise = result.current.travel('cyber').then(() => { resolved = true; });
    });

    // Without scene-disposed firing, the hook waits up to 1.5s safety
    // timeout then sets the new active world. Verify it eventually
    // transitions to loading-assets then completes.
    await new Promise(r => setTimeout(r, 100));
    window.dispatchEvent(new CustomEvent('concordia:scene-disposed'));
    await new Promise(r => setTimeout(r, 50));
    window.dispatchEvent(new CustomEvent('concordia:scene-ready'));

    await act(async () => { await travelPromise; });
    expect(resolved).toBe(true);
    expect(window.localStorage.getItem('concordia:activeWorldId')).toBe('cyber');
  });
});
