/**
 * Tier-2 frontend test for SoundscapeEngine's district ambient noise layer
 * (Wave 4 backlog, runtime-health-capability-map finding #2).
 *
 * BUG (pre-fix): the "Build district ambient drone" effect tore down the
 * previous drone OscillatorNode correctly (ramp gain to 0 + delayed .stop())
 * but built the noise AudioBufferSourceNode as a function-local `const`
 * never stored in a ref — so on every district/time-of-day/interior change a
 * brand new looping noise source was created while the previous one kept
 * playing forever (a still-looping source with no JS references is NOT
 * garbage-collected per the Web Audio spec). The silent-district early
 * return also never touched the noise layer, so a transition into a
 * `volume: 0` district (e.g. 'silent') left any existing noise hissing.
 *
 * This test proves the fix by asserting the FIRST noise source's .stop()
 * is actually invoked when the district changes, and again when the
 * district transitions to a silent one — not just that rendering doesn't
 * throw. Verified against the pre-fix source: without the `noiseSourceRef`
 * teardown, `firstNoise.stop` is never called and this test fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { tracks: [] } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import SoundscapeEngine from '@/components/world-lens/SoundscapeEngine';

/* ── Fake Web Audio graph — tracks every node it creates so the test can
   assert teardown calls, not just "no crash". ─────────────────────────── */

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillatorNode {
  type = 'sine';
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

// Every constructed noise source is pushed here so the test can inspect
// creation order + individually mocked .stop() calls.
const createdNoiseSources: FakeAudioBufferSourceNode[] = [];

class FakeAudioBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    createdNoiseSources.push(this);
  }
}

class FakeBiquadFilterNode {
  type = 'bandpass';
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  connect = vi.fn();
}

class FakeAudioBuffer {
  constructor(private channels: number, private length: number) {}
  getChannelData() {
    return new Float32Array(this.length);
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';
  destination = {};
  listener = {};
  createOscillator() { return new FakeOscillatorNode(); }
  createGain() { return new FakeGainNode(); }
  createBufferSource() { return new FakeAudioBufferSourceNode(); }
  createBiquadFilter() { return new FakeBiquadFilterNode(); }
  createBuffer(channels: number, length: number) { return new FakeAudioBuffer(channels, length); }
  createPanner() {
    return { positionX: new FakeAudioParam(), positionY: new FakeAudioParam(), positionZ: new FakeAudioParam(), connect: vi.fn(), panningModel: '', distanceModel: '', maxDistance: 0, refDistance: 0, rolloffFactor: 0 };
  }
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  resume = vi.fn().mockResolvedValue(undefined);
}

function dispatchSoundscapeCommand(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('concordia:soundscape-command', { detail }));
}

describe('SoundscapeEngine — district ambient noise layer teardown', () => {
  beforeEach(() => {
    createdNoiseSources.length = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops the previous noise source instead of leaking it when the district changes', async () => {
    render(<SoundscapeEngine initialDistrict="forge" />);

    // Mount effect builds the first noise layer synchronously (forge has
    // noise: 0.4, volume: 0.07 — both > 0).
    await act(async () => { await Promise.resolve(); });

    expect(createdNoiseSources.length).toBe(1);
    const firstNoise = createdNoiseSources[0];
    expect(firstNoise.start).toHaveBeenCalledTimes(1);
    expect(firstNoise.stop).not.toHaveBeenCalled();

    // Change district — setDistrict schedules a 400ms crossfade timer
    // before actually flipping state.currentDistrict.
    act(() => { dispatchSoundscapeCommand({ action: 'setDistrict', district: 'academy' }); });
    await act(async () => { vi.advanceTimersByTime(400); });

    // Second noise source now exists.
    expect(createdNoiseSources.length).toBe(2);
    const secondNoise = createdNoiseSources[1];
    expect(secondNoise.start).toHaveBeenCalledTimes(1);

    // The teardown of the first source is scheduled via a 600ms delayed
    // .stop() (mirroring the drone oscillator's own teardown pattern) —
    // it must not have fired yet.
    expect(firstNoise.stop).not.toHaveBeenCalled();

    // Advance past the 600ms teardown delay.
    await act(async () => { vi.advanceTimersByTime(600); });

    // THE ASSERTION THAT CATCHES THE BUG: pre-fix, noiseSource was a
    // function-local const never stored in a ref, so nothing ever called
    // .stop() on it and this line would fail.
    expect(firstNoise.stop).toHaveBeenCalledTimes(1);
    // The second (current) source must still be playing.
    expect(secondNoise.stop).not.toHaveBeenCalled();
  });

  it('stops the noise layer immediately when transitioning into a silent (volume:0) district', async () => {
    render(<SoundscapeEngine initialDistrict="academy" />);
    await act(async () => { await Promise.resolve(); });

    expect(createdNoiseSources.length).toBe(1);
    const noise = createdNoiseSources[0];
    expect(noise.stop).not.toHaveBeenCalled();

    // 'silent' is not a key in DISTRICT_ALIAS, so it falls through the
    // `?? 'silent'` default — same as any unrecognized district name.
    act(() => { dispatchSoundscapeCommand({ action: 'setDistrict', district: 'silent' }); });
    await act(async () => { vi.advanceTimersByTime(400); });

    // The silent-district branch stops the noise layer synchronously (no
    // 600ms delay) — a silent district must actually be silent immediately,
    // not just skip creating a new source while the old one keeps looping.
    expect(noise.stop).toHaveBeenCalledTimes(1);

    // No new noise source should have been created for the silent district.
    expect(createdNoiseSources.length).toBe(1);
  });

  it('never creates more than one concurrently-unstopped noise source across multiple district changes', async () => {
    render(<SoundscapeEngine initialDistrict="forge" />);
    await act(async () => { await Promise.resolve(); });

    const districts = ['academy', 'docks', 'commons', 'exchange'];
    for (const d of districts) {
      act(() => { dispatchSoundscapeCommand({ action: 'setDistrict', district: d }); });
      await act(async () => { vi.advanceTimersByTime(400); });
      await act(async () => { vi.advanceTimersByTime(600); });
    }

    expect(createdNoiseSources.length).toBe(1 + districts.length);
    // Every source except the very last one must have been stopped by now —
    // this is the "compounding hiss" the audit described: without the fix,
    // NONE of the earlier sources are ever stopped.
    const allButLast = createdNoiseSources.slice(0, -1);
    for (const src of allButLast) {
      expect(src.stop).toHaveBeenCalledTimes(1);
    }
    expect(createdNoiseSources[createdNoiseSources.length - 1].stop).not.toHaveBeenCalled();
  });
});
