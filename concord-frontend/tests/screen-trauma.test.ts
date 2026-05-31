// Track 1 — trauma-based screenshake. Pins the Eiserloh model: trauma clamps to
// [0,1] and accumulates, decays linearly to 0, output scales with trauma² (small
// bumps subtle / big hits dramatic), stays bounded by the configured max, is
// coherent (not random — successive frames are close), and the severity→trauma map.

import { describe, it, expect } from 'vitest';
import { createTraumaShake, traumaForSeverity } from '@/lib/concordia/screen-trauma';

describe('trauma screenshake', () => {
  it('trauma clamps to [0,1] and accumulates', () => {
    const s = createTraumaShake();
    s.addTrauma(0.4); expect(s.getTrauma()).toBeCloseTo(0.4);
    s.addTrauma(0.4); expect(s.getTrauma()).toBeCloseTo(0.8);
    s.addTrauma(0.9); expect(s.getTrauma()).toBe(1);           // clamped
    s.addTrauma(-5); expect(s.getTrauma()).toBe(0);            // floored
  });

  it('decays linearly to zero (and shake stops)', () => {
    const s = createTraumaShake({ decayPerSec: 1 });
    s.addTrauma(1);
    s.update(0.5); expect(s.getTrauma()).toBeCloseTo(0.5, 5);
    s.update(0.6); expect(s.getTrauma()).toBe(0);
    expect(s.update(0.016)).toEqual({ x: 0, y: 0, rot: 0 });   // no trauma → no shake
  });

  it('output scales with trauma² and stays within the configured max', () => {
    const s = createTraumaShake({ maxTranslatePx: 20, maxRotateRad: 0.1, decayPerSec: 0 });
    let peakHi = 0, peakLo = 0;
    s.addTrauma(1);
    for (let i = 0; i < 200; i++) peakHi = Math.max(peakHi, Math.abs(s.update(0.016).x));
    s.reset(); s.addTrauma(0.5);
    for (let i = 0; i < 200; i++) peakLo = Math.max(peakLo, Math.abs(s.update(0.016).x));
    expect(peakHi).toBeLessThanOrEqual(20.0001);               // bounded by max
    // trauma 0.5 → shake 0.25 vs trauma 1 → shake 1.0: the square makes the small hit ≪ the big one
    expect(peakLo).toBeLessThan(peakHi * 0.5);
  });

  it('is coherent — consecutive frames are close, not random jitter', () => {
    const s = createTraumaShake({ decayPerSec: 0 });
    s.addTrauma(1);
    const a = s.update(0.016);
    const b = s.update(0.016);
    // a single 16ms step moves the offset only a fraction of the full range (≤20px),
    // which random()-per-frame could never guarantee.
    expect(Math.abs(b.x - a.x)).toBeLessThan(12);
  });

  it('severity → trauma map matches the brief targets', () => {
    expect(traumaForSeverity('kill')).toBeGreaterThanOrEqual(0.8);
    expect(traumaForSeverity('combat-crit')).toBeCloseTo(0.5);
    expect(traumaForSeverity('hit')).toBeGreaterThan(0.25);
    expect(traumaForSeverity('hit')).toBeLessThan(0.5);
    expect(traumaForSeverity('explosion')).toBe(1);
    expect(traumaForSeverity('none')).toBe(0);
  });
});
