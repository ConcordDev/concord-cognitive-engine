/**
 * F8 — selective-bloom honesty contract (K6b). The load-bearing claim this
 * unit makes visually real: a scene element blooms because ITS OWN real value
 * is hot, not because the scene is generally bright. That reduces to a pure
 * emissive-intensity-vs-threshold relationship, provable here without a GPU:
 *
 *   - at IDLE (no in-flight work), both store-driven elements' glow maps to an
 *     emissive intensity BELOW the bloom threshold → they do NOT bloom.
 *   - while WORKING (a real macro in flight), glow maps ABOVE the threshold →
 *     they DO bloom.
 *
 * Both source glows are pure functions of REAL store signals
 * (`computeOrbitalRingsTarget(inFlight)`, `computeLatticeGlobeMotion(...)`), so
 * proving the mapping straddles the threshold proves "bloom ⟺ real work."
 */

import { describe, it, expect } from 'vitest';
import {
  EMISSIVE_GLOW_SCALE,
  EMISSIVE_BLOOM_THRESHOLD,
  BLOOM_LUMINANCE_THRESHOLD,
  emissiveIntensityForGlow,
  bloomsAtGlow,
} from './conkay-bloom';
import { computeOrbitalRingsTarget } from './orbital-rings-motion';
import { computeLatticeGlobeMotion } from './lattice-globe-motion';

describe('emissiveIntensityForGlow (pure mapping)', () => {
  it('scales glow linearly into emissive space', () => {
    expect(emissiveIntensityForGlow(0)).toBe(0);
    expect(emissiveIntensityForGlow(0.5)).toBeCloseTo(0.5 * EMISSIVE_GLOW_SCALE, 6);
    expect(emissiveIntensityForGlow(1)).toBeCloseTo(EMISSIVE_GLOW_SCALE, 6);
  });

  it('is monotonic — more real glow is never less bloom', () => {
    let prev = -Infinity;
    for (let g = 0; g <= 1.0001; g += 0.05) {
      const e = emissiveIntensityForGlow(g);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('is defensive: non-finite / negative glow clamps to 0 (dark, never NaN)', () => {
    expect(emissiveIntensityForGlow(-3)).toBe(0);
    expect(emissiveIntensityForGlow(Number.NaN)).toBe(0);
    expect(emissiveIntensityForGlow(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('the scale actually pushes the working range above the normal 0..1 range', () => {
    // The whole point of toneMapped=false + a near-1 threshold is that "hot"
    // emissive exceeds 1.0. A working glow of 0.53 must clear it.
    expect(emissiveIntensityForGlow(0.53)).toBeGreaterThan(1.0);
    // The screen-space Bloom threshold is genuinely selective (near 1, not 0.15).
    expect(BLOOM_LUMINANCE_THRESHOLD).toBeGreaterThan(0.8);
  });
});

describe('OrbitalRings: idle does NOT bloom, working DOES', () => {
  it('idle (inFlight 0): emissive is 0 — below threshold, no bloom', () => {
    const idle = computeOrbitalRingsTarget(0);
    expect(idle.mode).toBe('idle');
    const e = emissiveIntensityForGlow(idle.glowIntensity);
    expect(e).toBe(0);
    expect(e).toBeLessThan(EMISSIVE_BLOOM_THRESHOLD);
    expect(bloomsAtGlow(idle.glowIntensity)).toBe(false);
  });

  it('working (inFlight 1): emissive exceeds threshold — it blooms', () => {
    const working = computeOrbitalRingsTarget(1);
    expect(working.mode).toBe('working');
    const e = emissiveIntensityForGlow(working.glowIntensity);
    expect(e).toBeGreaterThan(EMISSIVE_BLOOM_THRESHOLD);
    expect(bloomsAtGlow(working.glowIntensity)).toBe(true);
  });

  it('every working level (1..8 concurrent runs) blooms; only idle does not', () => {
    for (let n = 1; n <= 8; n++) {
      expect(bloomsAtGlow(computeOrbitalRingsTarget(n).glowIntensity)).toBe(true);
    }
    expect(bloomsAtGlow(computeOrbitalRingsTarget(0).glowIntensity)).toBe(false);
  });
});

describe('LatticeGlobe: idle does NOT bloom, working DOES', () => {
  it('idle glow — across the full breath phase AND any real DTU-ref count — stays below threshold', () => {
    // The idle branch is capped at glow 0.24 (Math.min ceiling in
    // computeLatticeGlobeMotion); even the worst case must not bloom.
    for (const phase of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      for (const refs of [0, 5, 500]) {
        const m = computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: refs, idleBreathPhase: phase });
        expect(m.mode).toBe('idle');
        const e = emissiveIntensityForGlow(m.glowIntensity);
        expect(e).toBeLessThan(EMISSIVE_BLOOM_THRESHOLD);
        expect(bloomsAtGlow(m.glowIntensity)).toBe(false);
      }
    }
  });

  it('working (inFlight ≥ 1): emissive exceeds threshold — it blooms', () => {
    for (const refs of [0, 5, 50]) {
      const m = computeLatticeGlobeMotion({ inFlight: 1, dtuRefCount: refs });
      expect(m.mode).toBe('working');
      const e = emissiveIntensityForGlow(m.glowIntensity);
      expect(e).toBeGreaterThan(EMISSIVE_BLOOM_THRESHOLD);
      expect(bloomsAtGlow(m.glowIntensity)).toBe(true);
    }
  });

  it('there is a genuine gap between the idle ceiling and the working floor', () => {
    // Worst-case brightest idle vs. dimmest working — the two bands must not
    // overlap, or "blooming" would stop meaning "working".
    const brightestIdle = emissiveIntensityForGlow(
      computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 500, idleBreathPhase: Math.PI / 2 }).glowIntensity,
    );
    const dimmestWorking = emissiveIntensityForGlow(
      computeLatticeGlobeMotion({ inFlight: 1, dtuRefCount: 0 }).glowIntensity,
    );
    expect(brightestIdle).toBeLessThan(EMISSIVE_BLOOM_THRESHOLD);
    expect(dimmestWorking).toBeGreaterThan(EMISSIVE_BLOOM_THRESHOLD);
    expect(dimmestWorking).toBeGreaterThan(brightestIdle);
  });
});

describe('kill-mid-run acceptance clause (emissive side)', () => {
  it('when the upstream glow decays to the idle band, emissive drops below the bloom threshold', () => {
    // The store returns inFlight to its idle value on completion / reset (and,
    // per the report, SHOULD on socket-disconnect — see the flagged gap). This
    // proves the OTHER half F8 owns: once glow is back in the idle band, the
    // emissive materials this unit added genuinely go dark (stop blooming).
    const stillWorking = emissiveIntensityForGlow(computeOrbitalRingsTarget(2).glowIntensity);
    const afterKill = emissiveIntensityForGlow(computeOrbitalRingsTarget(0).glowIntensity);
    expect(stillWorking).toBeGreaterThan(EMISSIVE_BLOOM_THRESHOLD);
    expect(afterKill).toBe(0);
    expect(afterKill).toBeLessThan(EMISSIVE_BLOOM_THRESHOLD);
  });
});
