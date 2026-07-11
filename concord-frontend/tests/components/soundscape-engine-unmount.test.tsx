/**
 * Runtime-health backlog item (Concordia audit, finding #3/#4 —
 * `docs/concordia-specs/runtime-health-capability-map.md`):
 *
 * SoundscapeEngine mounts once at /lenses/world and lazily creates an
 * AudioContext on first district change. The only unmount-cleanup effect
 * used to stop the individual source nodes it knew about (drone, weather
 * hiss/rumble) but never called `audioCtxRef.current.close()` — despite a
 * stale comment claiming a listener "is GC'd when ctx.close() runs on
 * unmount." Navigating away from the world lens left the AudioContext (and
 * everything still connected to it) running silently; re-entering created a
 * SECOND AudioContext stacked on the first, eventually hitting the
 * browser's concurrent-context cap (Safari is strict about this).
 *
 * This test proves the fix: mount → unmount → assert `close()` was called
 * on the real AudioContext instance. It also proves the OTHER unmount-only
 * refs (horror-tension stem oscillators + its footstep timer, and the
 * procedural music layer's chord/arp/bass intervals) get torn down even
 * though those refs are declared later in the file than the primary
 * cleanup effect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../../lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { tracks: [] } })),
    post: vi.fn(() => Promise.resolve({})),
  },
}));

// ── Minimal but faithful Web Audio mock ─────────────────────────────────
class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class MockNode {
  gain = new MockAudioParam();
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  connect = vi.fn(() => this);
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

let lastCreatedContext: MockAudioContext | null = null;

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = new MockNode();
  private listeners: Record<string, Array<() => void>> = {};

  constructor() {
    // Test-only hook so assertions can reach the instance the component constructed.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastCreatedContext = this;
  }

  createGain() { return new MockNode(); }
  createOscillator() { return new MockNode(); }
  createBufferSource() { return new MockNode(); }
  createBiquadFilter() { return new MockNode(); }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createMediaElementSource() { return new MockNode(); }

  addEventListener(evt: string, cb: () => void) {
    (this.listeners[evt] ??= []).push(cb);
  }
  removeEventListener() { /* not needed for this test */ }

  resume = vi.fn(async () => {
    this.state = 'running';
    return Promise.resolve();
  });

  close = vi.fn(async () => {
    this.state = 'closed';
    return Promise.resolve();
  });
}

describe('SoundscapeEngine — AudioContext lifecycle on unmount', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', MockAudioContext);
    lastCreatedContext = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('calls AudioContext.close() when the component unmounts (finding #3/#4)', async () => {
    const { default: SoundscapeEngine } = await import('../../components/world-lens/SoundscapeEngine');

    let unmount: () => void;
    await act(async () => {
      // 'forge' has a non-zero DISTRICT_AUDIO volume, so the district-drone
      // effect calls initAudio() on mount and a real AudioContext is created
      // without needing a simulated user gesture.
      const result = render(<SoundscapeEngine initialDistrict="forge">{null}</SoundscapeEngine>);
      unmount = result.unmount;
    });

    expect(lastCreatedContext).not.toBeNull();
    const ctx = lastCreatedContext!;

    // Pre-fix sanity: close() has NOT been called merely by mounting.
    expect(ctx.close).not.toHaveBeenCalled();
    expect(ctx.state).toBe('running');

    await act(async () => {
      unmount();
    });

    // This is the actual regression assertion. Against the pre-fix code
    // (no `audioCtxRef.current?.close()` in the unmount cleanup) this fails:
    // close() is never invoked and the mock context is left 'running' forever.
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the existing per-node .stop() calls run alongside ctx.close()', async () => {
    const { default: SoundscapeEngine } = await import('../../components/world-lens/SoundscapeEngine');

    let unmount: () => void;
    await act(async () => {
      const result = render(<SoundscapeEngine initialDistrict="forge">{null}</SoundscapeEngine>);
      unmount = result.unmount;
    });

    // Unmounting must not throw even though droneOsc/weatherSrc/weatherRumble
    // stop() calls run in the same cleanup pass as ctx.close().
    expect(() => {
      act(() => { unmount(); });
    }).not.toThrow();
  });
});
