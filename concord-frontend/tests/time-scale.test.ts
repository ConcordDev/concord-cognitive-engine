// Track 1 — slow-mo wiring. Pins the time-scale primitive the AvatarSystem3D
// mixer loop now consumes: world scale (NPCs/physics) vs player scale (stays
// crisp inside a world slow-mo), the auto-restore window, and the ts=1 identity
// that keeps default behaviour byte-identical.
//
// Run: npx vitest run tests/time-scale.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTimeScale, getPlayerTimeScale, setTimeScale, slowMo, hitStop, resume,
} from '../lib/concordia/use-time-scale';

describe('time-scale primitive', () => {
  beforeEach(() => { resume(); });

  it('defaults to 1.0 (identity → unchanged default behaviour)', () => {
    expect(getTimeScale()).toBe(1.0);
    expect(getPlayerTimeScale()).toBe(1.0);
  });

  it('world slow-mo lifts the player toward responsive (0.5–0.8)', () => {
    slowMo(0.1, 5000);
    expect(getTimeScale()).toBeCloseTo(0.1, 5);
    const p = getPlayerTimeScale();
    expect(p).toBeGreaterThanOrEqual(0.5);
    expect(p).toBeLessThanOrEqual(0.8);
  });

  it('caps the player lift at 0.8 even for a mild world slow-mo', () => {
    setTimeScale(0.9, 5000);
    expect(getPlayerTimeScale()).toBeLessThanOrEqual(0.8);
  });

  it('a full hit-stop freezes the player too (world == 0 → player 0)', () => {
    hitStop(5000);
    expect(getTimeScale()).toBe(0);
    expect(getPlayerTimeScale()).toBe(0);
  });

  it('auto-restores to 1.0 after the duration window elapses', () => {
    setTimeScale(0.2, 1); // 1ms window
    const restore = (globalThis as unknown as { __concordia_time_scale_restore__?: number });
    // force the restore deadline into the past, then read.
    restore.__concordia_time_scale_restore__ = performance.now() - 10;
    expect(getTimeScale()).toBe(1.0);
  });
});
