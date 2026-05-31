// Track 2 (gate) — art-direction constants. Pins the single-source-of-truth rules
// so render passes can rely on them, and the per-world saturation philosophy.

import { describe, it, expect } from 'vitest';
import { ART_STYLE, WORLD_SATURATION, saturationForWorld } from '@/lib/world-lens/concordia-theme';

describe('art-style constants (coherence > fidelity)', () => {
  it('exposes one global outline weight, ramp-band count, and grounded dial', () => {
    expect(ART_STYLE.OUTLINE_WIDTH_M).toBeGreaterThan(0);
    expect(ART_STYLE.RAMP_BANDS).toBe(3);
    expect(ART_STYLE.GROUNDED_DIAL).toBeGreaterThanOrEqual(0);
    expect(ART_STYLE.GROUNDED_DIAL).toBeLessThanOrEqual(1);
  });

  it('per-world saturation encodes the mood philosophy (neon up, noir down)', () => {
    expect(WORLD_SATURATION.cyber).toBeGreaterThan(1);     // neon pushed
    expect(WORLD_SATURATION.crime).toBeLessThan(1);        // noir pulled
    expect(WORLD_SATURATION['concordia-hub']).toBe(1);     // neutral baseline
  });

  it('saturationForWorld resolves by world id + defaults to 1.0', () => {
    expect(saturationForWorld('cyber')).toBeGreaterThan(1);
    expect(saturationForWorld('crime')).toBeLessThan(1);
    expect(saturationForWorld(null)).toBeGreaterThan(0);   // some sane default
    expect(saturationForWorld('totally-unknown-world')).toBe(1.0);
  });
});
