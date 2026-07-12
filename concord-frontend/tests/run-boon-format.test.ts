// Wave 4 gap-closure — run-boon-format.ts is what turns the server's real
// {stat,value} boon/modifier numbers into HUD text. Pinned so a future stat
// addition can't silently regress to a raw "stat +value" fallback for a
// KNOWN stat, and so the displayed percentages are hand-verified correct.

import { describe, it, expect } from 'vitest';
import { describeBoonEffect, describeModifierBundle } from '@/lib/run-boon-format';

describe('describeBoonEffect', () => {
  it('formats a percentage stat from the real decimal value (0.25 -> +25%)', () => {
    expect(describeBoonEffect({ stat: 'damageMult', value: 0.25 })).toBe('damage +25%');
  });

  it('formats a flat stat without a percent sign', () => {
    expect(describeBoonEffect({ stat: 'maxHpFlat', value: 30 })).toBe('max HP +30');
  });

  it('formats a roguelite meta-unlock stat (startingHpBonus)', () => {
    expect(describeBoonEffect({ stat: 'startingHpBonus', value: 25 })).toBe('starting HP +25');
  });

  it('pluralizes revive count correctly', () => {
    expect(describeBoonEffect({ stat: 'revives', value: 1 })).toBe('1 revive');
    expect(describeBoonEffect({ stat: 'revives', value: 2 })).toBe('2 revives');
  });

  it('falls back to a derived (not fabricated) label for an unknown stat', () => {
    expect(describeBoonEffect({ stat: 'someFutureStat', value: 7 })).toBe('someFutureStat +7');
  });

  it('handles null/undefined without throwing', () => {
    expect(describeBoonEffect(null)).toBe('');
    expect(describeBoonEffect(undefined)).toBe('');
  });
});

describe('describeModifierBundle', () => {
  it('renders every non-zero stat in a bundle, hand-verified against the additive-stacking example', () => {
    // The exact bundle server/tests/integration/run-mode-gap-closure.test.js
    // proves for a blade_storm draft pick (+0.25) stacked with a purchased
    // sharp_start meta-unlock (+0.10): additive damageMult of 0.35.
    const lines = describeModifierBundle({ damageMult: 0.35, critChance: 0 });
    expect(lines).toEqual(['damage +35%']);
  });

  it('returns an empty array for an empty or missing bundle', () => {
    expect(describeModifierBundle({})).toEqual([]);
    expect(describeModifierBundle(null)).toEqual([]);
  });
});
