// POLISH_AUDIT T2.8 — camera FOV punch gating. Pins: punches only for the local
// player (attacker or target), severity-scaled, never under reduced-motion,
// never for a flinch/none, and NEVER for a witnessed NPC-vs-NPC strike.

import { describe, it, expect } from 'vitest';
import { computeImpactCameraPunch } from '@/lib/concordia/combat-camera';

const ME = 'user_me';

describe('T2.8 — computeImpactCameraPunch', () => {
  it('punches when the local player lands the killing blow', () => {
    const p = computeImpactCameraPunch({ isKill: true, attackerId: ME, targetId: 'npc1' }, { userId: ME, reducedMotion: false });
    expect(p).not.toBeNull();
    expect(p!.local_relevance).toBe(true);
    expect(p!.shake).toBe(8);
    expect(p!.zoom).toBeCloseTo(1.08);
  });

  it('punches when the local player is the one rocked', () => {
    const p = computeImpactCameraPunch({ severity: 'rocked', attackerId: 'npc1', targetId: ME }, { userId: ME, reducedMotion: false });
    expect(p).not.toBeNull();
    expect(p!.shake).toBe(5);
  });

  it('scales knockdown between rocked and kill', () => {
    const p = computeImpactCameraPunch({ severity: 'knockdown', attackerId: ME, targetId: 'npc1' }, { userId: ME, reducedMotion: false });
    expect(p!.shake).toBe(7);
  });

  it('does NOT punch on a witnessed NPC-vs-NPC strike (the keystone)', () => {
    const p = computeImpactCameraPunch({ isKill: true, attackerId: 'npc1', targetId: 'npc2' }, { userId: ME, reducedMotion: false });
    expect(p).toBeNull();
  });

  it('does NOT punch under reduced-motion, even when locally relevant', () => {
    const p = computeImpactCameraPunch({ isKill: true, attackerId: ME, targetId: 'npc1' }, { userId: ME, reducedMotion: true });
    expect(p).toBeNull();
  });

  it('does NOT punch on a light (flinch/none) outcome', () => {
    expect(computeImpactCameraPunch({ severity: 'flinch', attackerId: ME, targetId: 'npc1' }, { userId: ME, reducedMotion: false })).toBeNull();
    expect(computeImpactCameraPunch({ severity: 'none', attackerId: ME, targetId: 'npc1' }, { userId: ME, reducedMotion: false })).toBeNull();
  });

  it('does NOT punch when there is no local user', () => {
    expect(computeImpactCameraPunch({ isKill: true, attackerId: 'a', targetId: 'b' }, { userId: null, reducedMotion: false })).toBeNull();
  });

  it('stays within the consumer clamps (shake≤12, zoom-1≤0.25, 120≤dur≤2000)', () => {
    for (const ev of [{ isKill: true }, { severity: 'knockdown' as const }, { severity: 'rocked' as const }]) {
      const p = computeImpactCameraPunch({ ...ev, attackerId: ME, targetId: 'n' }, { userId: ME, reducedMotion: false })!;
      expect(p.shake).toBeLessThanOrEqual(12);
      expect(p.zoom - 1).toBeLessThanOrEqual(0.25);
      expect(p.duration_ms).toBeGreaterThanOrEqual(120);
      expect(p.duration_ms).toBeLessThanOrEqual(2000);
    }
  });
});
