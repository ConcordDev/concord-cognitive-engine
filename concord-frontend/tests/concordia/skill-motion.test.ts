import { describe, it, expect } from 'vitest';
import {
  elementMotion, effectiveTier, modulatedVfx, modulatedSfx, ELEMENT_MOTION_TABLE,
} from '@/lib/concordia/skill-motion';

describe('B3 — skill-modulated motion (pure)', () => {
  it('fire biases the tier UP (bigger arc), ice DOWN (sharp/small)', () => {
    expect(effectiveTier(3, 'fire')).toBe(4);
    expect(effectiveTier(3, 'ice')).toBe(2);
    expect(effectiveTier(3, 'lightning')).toBe(4);
  });

  it('tier bias clamps to the engine 1..5 range', () => {
    expect(effectiveTier(5, 'fire')).toBe(5);   // can't exceed 5
    expect(effectiveTier(1, 'ice')).toBe(1);    // can't drop below 1
  });

  it('no element / physical / unknown → base tier + base vfx/sfx unchanged', () => {
    expect(effectiveTier(3, null)).toBe(3);
    expect(effectiveTier(3, 'physical')).toBe(3);
    expect(modulatedVfx('woodchips', null)).toBe('woodchips');
    expect(modulatedSfx('axe_chop', 'physical')).toBe('axe_chop');
  });

  it('element overrides vfx + sfx so fire ≠ ice visually/audibly', () => {
    expect(modulatedVfx('arcane', 'fire')).toBe('flame');
    expect(modulatedVfx('arcane', 'ice')).toBe('frost');
    expect(modulatedSfx('spell_cast', 'lightning')).toBe('thunder');
    expect(modulatedVfx('arcane', 'fire')).not.toBe(modulatedVfx('arcane', 'ice'));
  });

  it('elementMotion is null for non-elements, a row for elements', () => {
    expect(elementMotion('')).toBeNull();
    expect(elementMotion('fire')).toEqual(ELEMENT_MOTION_TABLE.fire);
  });
});
