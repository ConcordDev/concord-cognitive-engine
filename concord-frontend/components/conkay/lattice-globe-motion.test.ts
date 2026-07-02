/**
 * F6 — lattice globe motion gating. `computeLatticeGlobeMotion` is the
 * load-bearing honesty contract for the K4 activity globe: idle vs. working
 * must be genuinely, visibly distinct, and every input is a real store
 * signal (inFlight, DTU-ref count) — never fabricated. Framework-free by
 * design (no three/@react-three/fiber import here) so this pins the contract
 * without mounting WebGL.
 */

import { describe, it, expect } from 'vitest';
import { computeLatticeGlobeMotion } from './lattice-globe-motion';

describe('computeLatticeGlobeMotion', () => {
  it('idle: no in-flight work and no DTU refs → idle mode with slow, dim values', () => {
    const m = computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 0 });
    expect(m.mode).toBe('idle');
    expect(m.rotationSpeed).toBeGreaterThan(0); // alive, not frozen
    expect(m.rotationSpeed).toBeLessThan(0.1);  // but a crawl
    expect(m.glowIntensity).toBeGreaterThanOrEqual(0);
    expect(m.glowIntensity).toBeLessThan(0.3);
  });

  it('idle breath oscillates smoothly with phase, staying within the idle band', () => {
    const samples = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI].map((phase) =>
      computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 0, idleBreathPhase: phase }),
    );
    for (const s of samples) {
      expect(s.mode).toBe('idle');
      expect(s.rotationSpeed).toBeGreaterThanOrEqual(0.03);
      expect(s.rotationSpeed).toBeLessThanOrEqual(0.05);
      expect(s.glowIntensity).toBeLessThan(0.3);
    }
    // The breath actually varies across phase — it's not a frozen constant.
    const glows = samples.map((s) => s.glowIntensity);
    expect(Math.max(...glows) - Math.min(...glows)).toBeGreaterThan(0);
  });

  it('working: inFlight > 0 → working mode with values well above the idle band', () => {
    const idle = computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 0 });
    const working = computeLatticeGlobeMotion({ inFlight: 1, dtuRefCount: 0 });
    expect(working.mode).toBe('working');
    expect(working.rotationSpeed).toBeGreaterThan(idle.rotationSpeed * 5);
    expect(working.glowIntensity).toBeGreaterThan(idle.glowIntensity * 2);
  });

  it('working values scale up with more concurrent real runs', () => {
    const one = computeLatticeGlobeMotion({ inFlight: 1, dtuRefCount: 0 });
    const three = computeLatticeGlobeMotion({ inFlight: 3, dtuRefCount: 0 });
    expect(three.rotationSpeed).toBeGreaterThan(one.rotationSpeed);
    expect(three.glowIntensity).toBeGreaterThan(one.glowIntensity);
  });

  it('working scaling is clamped — a burst of concurrent runs does not runaway-scale', () => {
    const at4 = computeLatticeGlobeMotion({ inFlight: 4, dtuRefCount: 0 });
    const at40 = computeLatticeGlobeMotion({ inFlight: 40, dtuRefCount: 0 });
    // rotationSpeed clamps via Math.min(inFlight, 4) exactly like OrbitalRings'
    // targetVel — beyond 4 concurrent runs it must not keep climbing.
    expect(at40.rotationSpeed).toBe(at4.rotationSpeed);
    // glowIntensity is capped at 1 (outer Math.min), mirroring OrbitalRings' targetGlow.
    expect(at40.glowIntensity).toBeLessThanOrEqual(1);
    expect(at40.glowIntensity).toBe(1);
  });

  it('a nonzero DTU-ref count is a real secondary signal while idle (not fabricated)', () => {
    const noRefs = computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 0 });
    const withRefs = computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 5 });
    expect(withRefs.mode).toBe('idle'); // still idle — refs alone are not "work"
    expect(withRefs.glowIntensity).toBeGreaterThan(noRefs.glowIntensity);
    // Even with a large ref count, idle never approaches working brightness.
    const manyRefs = computeLatticeGlobeMotion({ inFlight: 0, dtuRefCount: 500 });
    expect(manyRefs.glowIntensity).toBeLessThan(0.3);
  });

  it('DTU-ref count also brightens the globe while genuinely working', () => {
    const noRefs = computeLatticeGlobeMotion({ inFlight: 1, dtuRefCount: 0 });
    const withRefs = computeLatticeGlobeMotion({ inFlight: 1, dtuRefCount: 5 });
    expect(withRefs.mode).toBe('working');
    expect(withRefs.glowIntensity).toBeGreaterThan(noRefs.glowIntensity);
  });

  it('negative/garbage inputs never produce negative or NaN output', () => {
    const m = computeLatticeGlobeMotion({ inFlight: -3, dtuRefCount: -9 });
    expect(m.mode).toBe('idle'); // inFlight <= 0 is never "working"
    expect(Number.isFinite(m.rotationSpeed)).toBe(true);
    expect(Number.isFinite(m.glowIntensity)).toBe(true);
    expect(m.rotationSpeed).toBeGreaterThanOrEqual(0);
    expect(m.glowIntensity).toBeGreaterThanOrEqual(0);
  });
});
