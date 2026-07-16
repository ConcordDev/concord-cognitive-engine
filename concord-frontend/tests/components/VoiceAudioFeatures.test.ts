/**
 * lib/voice/audio-features.ts — the shared Web Audio acoustic feature
 * extraction VoiceprintEnroll.tsx and VoiceLiveTranscribe.tsx both call
 * (one implementation, not two subtly-different reimplementations).
 *
 * Pins:
 *  1. `accumulateFrame` + `finalizeVector` compute REAL values from
 *     synthetic frequency/time-domain data — hand-verified arithmetic, not
 *     "doesn't throw". This is the pure-math core, testable with no
 *     AudioContext/AnalyserNode at all.
 *  2. `captureVoiceFeatureVector`'s honest no-op contract: it NEVER
 *     fabricates a vector. No mic API → null. getUserMedia rejected → null.
 *     A real (mocked) Web Audio graph → a genuine computed vector.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  accumulateFrame,
  emptyAccumulator,
  finalizeVector,
  captureVoiceFeatureVector,
  type FrameAccumulator,
} from '@/lib/voice/audio-features';

describe('accumulateFrame + finalizeVector — pure math, hand-verified', () => {
  it('a single silent frame (all-zero time domain, uniform -100dB spectrum) yields near-zero features', () => {
    const freq = new Float32Array(8).fill(-100); // -100dB everywhere → uniform tiny linear magnitude
    const time = new Float32Array(8).fill(0);    // dead silence: 0 RMS, 0 zero-crossings
    const acc = emptyAccumulator();
    accumulateFrame(acc, freq, time, 8000 /* nyquist */);
    const v = finalizeVector(acc);
    // energy (RMS) must be exactly 0 for a silent buffer.
    expect(v[1]).toBe(0);
    // zero-crossing rate must be exactly 0 for a constant-zero buffer.
    expect(v[3]).toBe(0);
  });

  it('RMS energy is computed correctly for a known constant-amplitude time-domain buffer', () => {
    // time domain: 4 samples all at 0.5 → RMS = sqrt(mean(0.25)) = 0.5 exactly.
    const time = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const freq = new Float32Array(4).fill(-100);
    const acc = emptyAccumulator();
    accumulateFrame(acc, freq, time, 8000);
    const v = finalizeVector(acc);
    // finalizeVector's energy dim = round(min(1, rms*10)*1000)/1000 = round(min(1,5)*1000)/1000 = 1
    // (0.5 * 10 = 5, clamped to 1 by the min(1, ...) — the normalisation intentionally
    // saturates loud signals into the [0,1] comparable range.)
    expect(v[1]).toBe(1);
  });

  it('zero-crossing rate counts sign flips exactly: 4 flips across 5 samples', () => {
    // Time domain: +,-,+,-,+ → sign flips at every one of the 4 consecutive
    // pairs (i=1..4) → 4 crossings over 5 samples → rate 4/5 = 0.8.
    const time = new Float32Array([1, -1, 1, -1, 1]);
    const freq = new Float32Array(4).fill(-100);
    const acc = emptyAccumulator();
    accumulateFrame(acc, freq, time, 8000);
    const v = finalizeVector(acc);
    expect(v[3]).toBeCloseTo(0.8, 3);
  });

  it('spectral centroid + rolloff pick out where the energy actually is (a single dominant bin)', () => {
    // 8-bin spectrum, silence everywhere except bin 6 which is loud (0dB = magnitude 1).
    // magSum ≈ magnitude at bin 6 (others are negligible at -100dB), so:
    //   spectral centroid ≈ bin 6 (weighted mean dominated by the loud bin)
    //   spectral rolloff (85% cumulative energy) is also ≈ bin 6, since bin 6
    //     alone carries effectively all the energy.
    const freq = new Float32Array(8).fill(-100);
    freq[6] = 0; // 10^(0/20) = 1.0 — many orders of magnitude louder than the -100dB bins
    const time = new Float32Array(8).fill(0);
    const acc = emptyAccumulator();
    const nyquist = 8000;
    accumulateFrame(acc, freq, time, nyquist);
    const v = finalizeVector(acc);
    // pitch dim uses PEAK bin (loudest single bin), which is exactly bin 6 of 8 → (6/8)*nyquist = 6000.
    // Normalised: round((6000/4000)*1000)/1000 = 1.5.
    expect(v[0]).toBeCloseTo(1.5, 3);
    // centroid dim: weighted mean ≈ bin 6 too (dominant bin), normalised the same way.
    expect(v[2]).toBeCloseTo(1.5, 2);
    // rolloff dim: 85%-cumulative-energy bin is also ≈ bin 6 → normalised by /8000 nyquist scale.
    // rollBin/freq.length * nyquist = 6/8*8000 = 6000 → round(6000/8000*1000)/1000 = 0.75.
    expect(v[4]).toBeCloseTo(0.75, 2);
  });

  it('accumulateFrame is a true running accumulator — multiple frames average correctly (below the saturation clamp, so the mean is actually distinguishable)', () => {
    const acc: FrameAccumulator = emptyAccumulator();
    // Frame 1: constant amplitude 0.02 → RMS = 0.02 exactly.
    accumulateFrame(acc, new Float32Array(4).fill(-100), new Float32Array([0.02, 0.02, 0.02, 0.02]), 8000);
    // Frame 2: constant amplitude 0.04 → RMS = 0.04 exactly.
    accumulateFrame(acc, new Float32Array(4).fill(-100), new Float32Array([0.04, 0.04, 0.04, 0.04]), 8000);
    expect(acc.n).toBe(2);
    // Mean RMS = (0.02 + 0.04) / 2 = 0.03 → energy dim = round(min(1, 0.03*10)*1000)/1000 = 0.3.
    // (Below the min(1,·) saturation ceiling, so this genuinely proves the
    // accumulator divides by n rather than e.g. summing without averaging —
    // a sum-only bug would report 0.6, not 0.3.)
    const v = finalizeVector(acc);
    expect(v[1]).toBeCloseTo(0.3, 3);
  });

  it('finalizeVector on a fresh (zero-sample) accumulator does not divide by zero', () => {
    const v = finalizeVector(emptyAccumulator());
    expect(v).toHaveLength(5);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
    expect(v).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('captureVoiceFeatureVector — honest no-op contract (never fabricates)', () => {
  const originalMediaDevices = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  const originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
    (window as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it('resolves null (not a fabricated vector) when the browser has no mediaDevices.getUserMedia', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const v = await captureVoiceFeatureVector(10);
    expect(v).toBeNull();
  });

  it('resolves null when getUserMedia rejects (permission denied) — never fabricates a vector', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')) },
      configurable: true,
    });
    const v = await captureVoiceFeatureVector(10);
    expect(v).toBeNull();
  });

  it('resolves null when the browser has mic access but no AudioContext constructor at all', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
      configurable: true,
    });
    (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
    const v = await captureVoiceFeatureVector(10);
    expect(v).toBeNull();
  });

  it('produces a real 5-dim computed vector when mic + Web Audio are genuinely available', async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
      configurable: true,
    });

    class FakeAnalyser {
      fftSize = 2048;
      frequencyBinCount = 4;
      getFloatFrequencyData(arr: Float32Array) { arr.fill(-100); arr[2] = 0; }
      getFloatTimeDomainData(arr: Float32Array) { arr.fill(0.1); }
    }
    class FakeAudioCtx {
      sampleRate = 16000;
      createMediaStreamSource() { return { connect: vi.fn() }; }
      createAnalyser() { return new FakeAnalyser(); }
      close() { return Promise.resolve(); }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioCtx as unknown;

    // requestAnimationFrame: run the sampling loop exactly once, then let the
    // sampleMs budget (0ms here) end the loop on the second scheduled tick.
    let rafCalls = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCalls += 1;
      cb(0);
      return rafCalls;
    });

    const v = await captureVoiceFeatureVector(0);
    expect(v).not.toBeNull();
    expect(v).toHaveLength(5);
    // Exact computed value: peak bin 2 of 4, nyquist 8000 (sampleRate 16000/2)
    // → pitch Hz = (2/4)*8000 = 4000 → normalised dim0 = round((4000/4000)*1000)/1000 = 1.
    expect(v![0]).toBeCloseTo(1, 3);
    expect(stopTrack).toHaveBeenCalled(); // mic track was actually released

    vi.unstubAllGlobals();
  });
});
