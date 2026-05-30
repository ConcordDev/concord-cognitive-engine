import { describe, it, expect } from 'vitest';
import { resolveMove, tierForLevel } from '@/lib/concordia/move-resolver';
import { SKILL_KIND_MOTION, clampTier } from '@/lib/concordia/move-catalog/move-types';

// Universal Move System Phase 1 — the resolver closes the audit gap (no created
// move plays a generic `cast` anymore). Pure, never-null, backward-compatible.

describe('Move System P1 — tierForLevel (Pillar 1: level gates the tier)', () => {
  it('a L1 move is tier 1 no matter the design; tiers climb with level', () => {
    expect(tierForLevel(1)).toBe(1);
    expect(tierForLevel(9)).toBe(1);
    expect(tierForLevel(60)).toBe(2);   // revision 5
    expect(tierForLevel(160)).toBe(3);  // revision 15
    expect(tierForLevel(520)).toBe(4);  // revision 50+
    expect(tierForLevel(1600)).toBe(5); // revision 150+ (visual ceiling)
  });
  it('saturates at 5 (visual ceiling) while levels keep climbing', () => {
    expect(tierForLevel(9999)).toBe(5);
  });
  it('garbage level → tier 1', () => {
    expect(tierForLevel(undefined)).toBe(1);
    expect(tierForLevel(0)).toBe(1);
  });
});

describe('Move System P1 — resolveMove', () => {
  it('derives a full move from skill_kind + element when no motion block (backward-compat)', () => {
    const r = resolveMove({ skillKind: 'spell', element: 'fire', skillLevel: 1 });
    expect(r.motionFamily).toBe('magic');
    expect(r.motionArchetype).toBe('cast_channel');
    expect(r.resourceGauge).toBe('mana');       // Pillar 2: spell drains mana
    expect(r.effectArchetype).toBe('projectile'); // fire → projectile bias
    expect(r.element).toBe('fire');
    expect(r.tier).toBeGreaterThanOrEqual(1);
  });

  it('a level-1 vs a level-200 SAME move differ only in tier (Pillar 1)', () => {
    const lo = resolveMove({ skillKind: 'spell', element: 'fire', skillLevel: 1 });
    const hi = resolveMove({ skillKind: 'spell', element: 'fire', skillLevel: 200 });
    expect(hi.tier).toBeGreaterThan(lo.tier);
    expect(hi.motionArchetype).toBe(lo.motionArchetype); // same design
    expect(hi.element).toBe(lo.element);
  });

  it('each skill_kind drains its lore-appropriate gauge (Pillar 2)', () => {
    expect(resolveMove({ skillKind: 'biopower' }).resourceGauge).toBe('bio');
    expect(resolveMove({ skillKind: 'cyber_ability' }).resourceGauge).toBe('charge');
    expect(resolveMove({ skillKind: 'fighting_style' }).resourceGauge).toBe('stamina');
    expect(resolveMove({ skillKind: 'psionic' }).resourceGauge).toBe('mana');
  });

  it('an authored motion block overrides the derived defaults', () => {
    const r = resolveMove({
      motion: { motionArchetype: 'thrust', effectArchetype: 'beam', targetShape: 'line', resourceGauge: 'charge' },
      skillKind: 'spell', element: 'lightning', skillLevel: 50,
    });
    expect(r.motionArchetype).toBe('thrust');   // authored wins over skill_kind default
    expect(r.effectArchetype).toBe('beam');
    expect(r.targetShape).toBe('line');
    expect(r.resourceGauge).toBe('charge');
  });

  it('element drives distinct VFX so fire ≠ ice', () => {
    const fire = resolveMove({ skillKind: 'spell', element: 'fire' });
    const ice = resolveMove({ skillKind: 'spell', element: 'ice' });
    expect(fire.vfx).not.toBe(ice.vfx);
    expect(ice.effectArchetype).toBe('ground_zone'); // ice bias
  });

  it('never returns null / always has a sensible default (unknown kind + element)', () => {
    const r = resolveMove({ skillKind: 'zorp', element: 'glorbo' });
    expect(r).toBeTruthy();
    expect(r.motionArchetype).toBeTruthy();
    expect(r.effectArchetype).toBeTruthy();
    expect(r.tier).toBe(1);
  });

  it('SKILL_KIND_MOTION covers all 7 authored kinds', () => {
    expect(Object.keys(SKILL_KIND_MOTION).sort()).toEqual(
      ['biopower', 'cyber_ability', 'fighting_style', 'mundane', 'psionic', 'spell', 'tech_gadget'],
    );
  });

  it('clampTier bounds to 1..5', () => {
    expect(clampTier(0)).toBe(1);
    expect(clampTier(99)).toBe(5);
    expect(clampTier(3)).toBe(3);
  });
});
