// Track 1 — additive breathing over all states. Pins the pure chest-scale
// helper the AvatarSystem3D per-frame loop now applies to the player AND NPCs
// regardless of moving/idle, plus the per-id phase desync.
//
// Run: npx vitest run tests/breathing.test.ts

import { describe, it, expect } from 'vitest';
import { breathingChestScaleY, breathPhaseFromId } from '../lib/concordia/gait-synthesis';

describe('breathingChestScaleY', () => {
  it('oscillates tightly around 1 (subtle, never distorting)', () => {
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < 20; t += 0.05) {
      const s = breathingChestScaleY(t, 1, false);
      min = Math.min(min, s); max = Math.max(max, s);
    }
    expect(min).toBeGreaterThan(0.99);
    expect(max).toBeLessThan(1.01);
    expect(min).toBeLessThan(1);  // it does dip below 1
    expect(max).toBeGreaterThan(1); // and rise above
  });

  it('breathes shallower while moving than at rest', () => {
    // sample the peak amplitude of each by scanning a full cycle.
    const peak = (moving: boolean) => {
      let m = 0;
      for (let t = 0; t < 10; t += 0.01) m = Math.max(m, Math.abs(breathingChestScaleY(t, 1, moving) - 1));
      return m;
    };
    expect(peak(true)).toBeLessThan(peak(false));
  });

  it('scales amplitude with idleBreathScale', () => {
    const peak = (scale: number) => {
      let m = 0;
      for (let t = 0; t < 10; t += 0.01) m = Math.max(m, Math.abs(breathingChestScaleY(t, scale, false) - 1));
      return m;
    };
    expect(peak(2)).toBeGreaterThan(peak(1));
  });

  it('is identity-amplitude when idleBreathScale is 0', () => {
    expect(breathingChestScaleY(5, 0, false)).toBe(1);
  });
});

describe('breathPhaseFromId', () => {
  it('is deterministic and in [0, 2π)', () => {
    const a = breathPhaseFromId('npc_alpha');
    expect(breathPhaseFromId('npc_alpha')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
  });

  it('desyncs different ids', () => {
    expect(breathPhaseFromId('npc_alpha')).not.toBe(breathPhaseFromId('npc_beta'));
  });
});
