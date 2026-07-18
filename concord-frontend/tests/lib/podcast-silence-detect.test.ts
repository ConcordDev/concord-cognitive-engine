// tests/lib/podcast-silence-detect.test.ts
//
// Pins the real RMS-threshold silence-detection math behind the podcast
// player's `trimSilence` preference (previously stored but with no engine
// behind it — docs/WAVE4_INVENTORY.md podcast row / podcast-capability-map
// "Found, documented, deliberately not changed"). Every assertion here
// operates on actual synthesized `Float32Array` PCM samples and real RMS
// arithmetic — no fabricated range lists.
import { describe, it, expect } from 'vitest';
import {
  computeRms,
  computeRmsWindows,
  findSilenceRanges,
  scanBlockForSilence,
  newSilenceScanCarry,
  silenceSkipTarget,
  resolveSilenceAutoSkip,
  SILENCE_DEFAULTS,
} from '../../lib/podcast/silence-detect';

const SR = 8000; // sample rate used throughout — cheap to synthesize, exact math

function silentBuffer(seconds: number, sr = SR): Float32Array {
  return new Float32Array(Math.round(seconds * sr)); // zero-filled
}

/** A pure sine tone at `freqHz`, amplitude `amp` — real RMS of a sine wave
 * is amp / sqrt(2), which is the hand-verification anchor below. */
function toneBuffer(seconds: number, amp = 0.5, freqHz = 440, sr = SR): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / sr);
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe('computeRms — hand-verified against the real formula', () => {
  it('is 0 for a fully silent buffer', () => {
    expect(computeRms(silentBuffer(1))).toBe(0);
  });

  it('matches amp/sqrt(2) for a full-period pure sine tone (hand-verified)', () => {
    // A sine wave sampled over exact whole periods has RMS = amp / sqrt(2).
    // 440Hz over 1s at 8000Hz is not an exact whole number of periods, so
    // use a frequency chosen to divide the sample rate evenly (100Hz @
    // 8000Hz = 80 samples/cycle, 1s = 80 whole cycles) for an exact check.
    const amp = 0.5;
    const samples = toneBuffer(1, amp, 100, SR);
    const rms = computeRms(samples);
    const expected = amp / Math.sqrt(2); // ≈ 0.35355
    expect(rms).toBeCloseTo(expected, 3);
  });

  it('is 0 for an empty array', () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });
});

describe('computeRmsWindows', () => {
  it('produces one RMS value per fixed-size window', () => {
    const samples = toneBuffer(1, 0.5, 100, SR); // 1s @ 8000Hz
    const windows = computeRmsWindows(samples, SR, 0.25); // 4 windows of 0.25s
    expect(windows).toHaveLength(4);
    for (const w of windows) expect(w).toBeCloseTo(0.5 / Math.sqrt(2), 2);
  });

  it('returns [] for empty samples or a non-finite sample rate', () => {
    expect(computeRmsWindows(new Float32Array(0), SR)).toEqual([]);
    expect(computeRmsWindows(toneBuffer(1), NaN)).toEqual([]);
  });
});

describe('findSilenceRanges — synthetic hand-verification cases', () => {
  it('a fully silent 3s buffer is detected as one silent range covering the whole buffer', () => {
    const samples = silentBuffer(3);
    const ranges = findSilenceRanges(samples, SR);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startSec).toBeCloseTo(0, 3);
    expect(ranges[0].endSec).toBeCloseTo(3, 2);
  });

  it('a fully loud 3s tone buffer is NOT detected as silent anywhere', () => {
    const samples = toneBuffer(3, 0.5, 440, SR); // RMS ~0.354, well above default 0.02 threshold
    const ranges = findSilenceRanges(samples, SR);
    expect(ranges).toEqual([]);
  });

  it('correctly locates a real silent gap in the middle of loud audio (hand-verified boundaries)', () => {
    // 2s loud, 3s silent, 2s loud = 7s total. The silent gap should be
    // reported as approximately [2, 5).
    const loudA = toneBuffer(2, 0.5, 220, SR);
    const gap = silentBuffer(3);
    const loudB = toneBuffer(2, 0.5, 220, SR);
    const samples = concat(loudA, gap, loudB);
    const ranges = findSilenceRanges(samples, SR);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startSec).toBeCloseTo(2, 1);
    expect(ranges[0].endSec).toBeCloseTo(5, 1);
  });

  it('does NOT report a short sub-threshold pause (below minSilenceSec) as a silence range', () => {
    // 1s loud, 0.3s silent (well under the 1.5s default minimum), 1s loud.
    const samples = concat(toneBuffer(1, 0.5, 220, SR), silentBuffer(0.3), toneBuffer(1, 0.5, 220, SR));
    const ranges = findSilenceRanges(samples, SR);
    expect(ranges).toEqual([]);
  });

  it('respects a custom minSilenceSec threshold', () => {
    const samples = concat(toneBuffer(1, 0.5, 220, SR), silentBuffer(0.3), toneBuffer(1, 0.5, 220, SR));
    const ranges = findSilenceRanges(samples, SR, { minSilenceSec: 0.1 });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].endSec - ranges[0].startSec).toBeCloseTo(0.3, 1);
  });

  it('uses SILENCE_DEFAULTS when no options are passed', () => {
    expect(SILENCE_DEFAULTS.thresholdRms).toBe(0.02);
    expect(SILENCE_DEFAULTS.minSilenceSec).toBe(1.5);
    expect(SILENCE_DEFAULTS.windowSec).toBe(0.05);
  });
});

describe('scanBlockForSilence — chunked/streaming scan carries state across block boundaries', () => {
  it('a silence spanning two chunks is reported as one continuous range, not two fragments', () => {
    // Chunk 1: 1s loud + 1s silent (silence still "open" at chunk end).
    // Chunk 2: 1s silent + 1s loud (silence closes 1s in).
    const chunk1 = concat(toneBuffer(1, 0.5, 220, SR), silentBuffer(1));
    const chunk2 = concat(silentBuffer(1), toneBuffer(1, 0.5, 220, SR));

    const first = scanBlockForSilence(chunk1, SR, 0, newSilenceScanCarry());
    expect(first.ranges).toEqual([]); // nothing closes within chunk 1 alone
    expect(first.carry.openSilenceStartSec).toBeCloseTo(1, 1);

    const second = scanBlockForSilence(chunk2, SR, 2 /* chunk1 was 2s long */, first.carry);
    expect(second.ranges).toHaveLength(1);
    expect(second.ranges[0].startSec).toBeCloseTo(1, 1); // opened during chunk 1
    expect(second.ranges[0].endSec).toBeCloseTo(3, 1); // closed 1s into chunk 2
  });
});

describe('silenceSkipTarget — playback-position lookup against known ranges', () => {
  const ranges = [{ startSec: 5, endSec: 10 }, { startSec: 20, endSec: 25 }];

  it('returns the range end when position is inside a known range', () => {
    expect(silenceSkipTarget(ranges, 5)).toBe(10);
    expect(silenceSkipTarget(ranges, 7.5)).toBe(10);
  });

  it('returns null when position is outside every known range', () => {
    expect(silenceSkipTarget(ranges, 0)).toBeNull();
    expect(silenceSkipTarget(ranges, 12)).toBeNull();
    expect(silenceSkipTarget(ranges, 30)).toBeNull();
  });

  it('returns null once position reaches a range end (no repeat-trigger at the boundary)', () => {
    expect(silenceSkipTarget(ranges, 10)).toBeNull();
  });

  it('returns null for an empty ranges list (nothing analyzed yet — honest no-op)', () => {
    expect(silenceSkipTarget([], 5)).toBeNull();
  });
});

describe('resolveSilenceAutoSkip — the exact gate the player checks on every timeupdate', () => {
  const ranges = [{ startSec: 5, endSec: 10 }];

  it('fires (returns the skip target) when trimSilence is ON and position is inside a detected range', () => {
    expect(resolveSilenceAutoSkip(true, ranges, 6)).toBe(10);
  });

  it('does NOT fire when trimSilence is OFF, even inside a detected range', () => {
    expect(resolveSilenceAutoSkip(false, ranges, 6)).toBeNull();
  });

  it('does NOT fire when trimSilence is ON but position is outside every range', () => {
    expect(resolveSilenceAutoSkip(true, ranges, 100)).toBeNull();
  });
});
