// tests/lib/daw-waveform-peaks.test.ts
//
// Pins `generateWaveformPeaks` (lib/daw/engine.ts) — the real peak
// extractor over a decoded Web Audio `AudioBuffer` — as the honest source
// of truth for audio waveform visuals across the app (daily/voice/feed
// lenses). Every assertion here operates on known, real sample data: given
// specific channel values, the function must return the exact max-|sample|
// peak per block, never a fabricated or randomized shape.
//
// Companion to server/tests/media-dtu-honest-waveform.test.js, which pins
// that the server-side path (which cannot decode compressed audio) is
// honestly `null` rather than another synthesized curve.
import { describe, it, expect } from 'vitest';
import { generateWaveformPeaks } from '@/lib/daw/engine';

/** Minimal AudioBuffer stand-in — generateWaveformPeaks only calls getChannelData(0). */
function fakeAudioBuffer(samples: number[]): AudioBuffer {
  const channelData = Float32Array.from(samples);
  return {
    getChannelData: (_channel: number) => channelData,
  } as unknown as AudioBuffer;
}

describe('generateWaveformPeaks — real peak extraction from AudioBuffer samples', () => {
  it('computes the exact max-|sample| peak per block from known channel data', () => {
    // 8 samples split into 2 buckets => blockSize = 4
    // block 0: [0.1, -0.9, 0.3, 0.2]   -> peak |−0.9| = 0.9
    // block 1: [-0.05, 0.6, -0.6, 0.6] -> peak |0.6| (or |−0.6|) = 0.6
    const samples = [0.1, -0.9, 0.3, 0.2, -0.05, 0.6, -0.6, 0.6];
    const peaks = generateWaveformPeaks(fakeAudioBuffer(samples), 2);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(0.9, 5);
    expect(peaks[1]).toBeCloseTo(0.6, 5);
  });

  it('returns all-zero peaks for real silence — never fabricates amplitude where the signal has none', () => {
    const samples = new Array(40).fill(0);
    const peaks = generateWaveformPeaks(fakeAudioBuffer(samples), 4);
    expect(peaks.every((p) => p === 0)).toBe(true);
  });

  it('tracks a rising-then-falling real amplitude envelope block by block (not a decorative curve unrelated to the input)', () => {
    // Each block of 10 has a distinct known peak: 0.1, 0.5, 0.9, 0.3
    const block = (peak: number) => Array.from({ length: 10 }, (_, i) => (i === 3 ? peak : 0.01 * i));
    const samples = [...block(0.1), ...block(0.5), ...block(0.9), ...block(0.3)];
    const peaks = generateWaveformPeaks(fakeAudioBuffer(samples), 4);
    expect(peaks[0]).toBeCloseTo(0.1, 5);
    expect(peaks[1]).toBeCloseTo(0.5, 5);
    expect(peaks[2]).toBeCloseTo(0.9, 5);
    expect(peaks[3]).toBeCloseTo(0.3, 5);
  });

  it('honors the requested numSamples bucket count regardless of source length', () => {
    const samples = Array.from({ length: 997 }, (_, i) => Math.sin(i) * 0.5);
    const peaks = generateWaveformPeaks(fakeAudioBuffer(samples), 20);
    expect(peaks).toHaveLength(20);
  });

  it('defaults to 200 buckets when numSamples is omitted', () => {
    const samples = Array.from({ length: 4000 }, () => 0.5);
    const peaks = generateWaveformPeaks(fakeAudioBuffer(samples));
    expect(peaks).toHaveLength(200);
  });
});
