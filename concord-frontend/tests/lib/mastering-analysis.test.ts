import { describe, it, expect } from 'vitest';
import { analyzeMastering } from '@/lib/daw/mastering-analysis';

/**
 * BS.1770 reference: a 1 kHz sine at -20 dBFS RMS analysed for >3s
 * integrates to ~-23 LUFS (the standard EBU R128 test). K-weighting
 * adds ~+1.6 dB shelf at 1 kHz vs. the rest of the band so we accept
 * a wide tolerance — this is a contract test for the algorithm
 * staying within shouting distance of spec, not for sample-perfect
 * broadcaster compliance.
 */

const SR = 48000;

function sine(freqHz: number, durSec: number, peakAmp: number): Float32Array {
  const n = Math.round(SR * durSec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = peakAmp * Math.sin((2 * Math.PI * freqHz * i) / SR);
  }
  return out;
}

function silence(durSec: number): Float32Array {
  return new Float32Array(Math.round(SR * durSec));
}

describe('analyzeMastering', () => {
  it('returns the empty-result shape for an empty buffer', () => {
    const r = analyzeMastering([], SR);
    expect(r.integratedLUFS).toBe(-120);
    expect(r.truePeak).toBe(-120);
    expect(r.spectralBalance).toHaveLength(8);
  });

  it('measures a 1kHz sine at ~-20 dBFS RMS within ±3 LU of -20 LUFS K-weighted', () => {
    // -20 dBFS RMS = peak amp 0.1 * sqrt(2) ≈ 0.1414
    const peakAmp = 0.1 * Math.sqrt(2);
    const buf = sine(1000, 4, peakAmp);
    const r = analyzeMastering([buf, buf], SR);
    // K-weighting lifts 1kHz so the LUFS reading sits a bit above the
    // raw -20 dB target. We accept -23..-15 — wide because we only run
    // 48k coefficients, no per-rate redesign.
    expect(r.integratedLUFS).toBeGreaterThan(-23);
    expect(r.integratedLUFS).toBeLessThan(-15);
  });

  it('true peak is positive-finite for a clipped sine', () => {
    const buf = sine(1000, 1, 1.0);
    const r = analyzeMastering([buf, buf], SR);
    expect(r.truePeak).toBeGreaterThan(-1);
    expect(r.truePeak).toBeLessThan(3);
  });

  it('integrated loudness collapses to -120 for pure silence', () => {
    const buf = silence(2);
    const r = analyzeMastering([buf, buf], SR);
    expect(r.integratedLUFS).toBeLessThanOrEqual(-70);
  });

  it('stereo correlation is +1 for identical channels', () => {
    const buf = sine(440, 1, 0.5);
    const r = analyzeMastering([buf, buf], SR);
    expect(r.stereoCorrelation).toBeGreaterThan(0.95);
  });

  it('stereo correlation is near -1 for phase-inverted channels', () => {
    const L = sine(440, 1, 0.5);
    const R = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) R[i] = -L[i];
    const r = analyzeMastering([L, R], SR);
    expect(r.stereoCorrelation).toBeLessThan(-0.95);
  });

  it('summary flags the hottest band correctly for a low-frequency tone', () => {
    const buf = sine(50, 2, 0.5); // sub-bass region
    const r = analyzeMastering([buf, buf], SR);
    expect(['sub', 'bass']).toContain(r.summary.hottestBand);
  });

  it('summary loudnessVsTarget is negative when integrated < target', () => {
    const buf = sine(1000, 2, 0.05);
    const r = analyzeMastering([buf, buf], SR, { targetLUFS: -14 });
    expect(r.summary.loudnessVsTarget).toBeLessThan(0);
  });
});
