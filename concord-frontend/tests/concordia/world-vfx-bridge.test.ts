import { describe, it, expect } from 'vitest';
import { particleParamsForType } from '@/lib/world-lens/world-vfx-bridge';

const LISTED_TYPES = [
  'impact',
  'impact_wood',
  'impact_stone',
  'impact_soil',
  'dust',
  'dirt',
  'rock_debris',
  'woodchips',
  'leaves',
  'sparkle',
  'sparks',
  'smoke',
  'steam',
  'splash',
  'water',
  'water_pour',
  'heal',
  'cast',
  'arcane',
  'flash',
  'glitch',
];

describe('particleParamsForType', () => {
  it('returns valid params for every listed type', () => {
    for (const type of LISTED_TYPES) {
      const p = particleParamsForType(type);
      expect(p, type).toBeTruthy();
      expect(typeof p.color, `${type}.color`).toBe('number');
      expect(Number.isFinite(p.color), `${type}.color finite`).toBe(true);
      expect(p.count, `${type}.count`).toBeGreaterThan(0);
      expect(p.lifetimeMs, `${type}.lifetimeMs`).toBeGreaterThan(0);
      expect(p.size, `${type}.size`).toBeGreaterThan(0);
      expect(Number.isFinite(p.spread), `${type}.spread`).toBe(true);
      expect(Number.isFinite(p.speed), `${type}.speed`).toBe(true);
      expect(Number.isFinite(p.gravity), `${type}.gravity`).toBe(true);
    }
  });

  it('returns the default for an unknown type', () => {
    const def = particleParamsForType('totally_made_up_xyz');
    expect(def).toBeTruthy();
    expect(typeof def.color).toBe('number');
    expect(def.count).toBeGreaterThan(0);
    expect(def.lifetimeMs).toBeGreaterThan(0);
    expect(def.size).toBeGreaterThan(0);
  });

  it('falls back to the default for empty string', () => {
    const def = particleParamsForType('');
    expect(def.count).toBeGreaterThan(0);
    expect(def.lifetimeMs).toBeGreaterThan(0);
  });

  it('distinguishes impact* effects from sparkle and heal', () => {
    const impact = particleParamsForType('impact');
    const impactWood = particleParamsForType('impact_wood');
    const impactStone = particleParamsForType('impact_stone');
    const sparkle = particleParamsForType('sparkle');
    const heal = particleParamsForType('heal');

    // Heal rises (positive gravity); impacts fall (negative gravity).
    expect(heal.gravity).toBeGreaterThan(0);
    expect(impact.gravity).toBeLessThan(0);
    expect(impactWood.gravity).toBeLessThan(0);
    expect(impactStone.gravity).toBeLessThan(0);

    // The effects are genuinely different presets, not the same object.
    expect(impact.color).not.toBe(sparkle.color);
    expect(impact.color).not.toBe(heal.color);
    expect(impactWood.color).not.toBe(impactStone.color);
  });

  it('returns a fresh object for the default each call (no shared mutation)', () => {
    const a = particleParamsForType('unknown_a');
    const b = particleParamsForType('unknown_b');
    a.count = 999;
    expect(b.count).not.toBe(999);
  });
});
