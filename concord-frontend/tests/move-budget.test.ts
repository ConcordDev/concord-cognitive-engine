// MS-P2 — the move-builder's Enhancement-Diversification budget. Pins the
// diminishing-returns curve (stacking one aspect plateaus), the balance check
// (no aspect > 60% of effective value), overspend, and tier scaling.

import { describe, it, expect } from 'vitest';
import { effectiveAspect, resolveBudget, budgetForTier, DEFAULT_BUDGET } from '@/lib/concordia/move-budget';

describe('Enhancement Diversification', () => {
  it('stacking one aspect hits diminishing returns (the anti-one-shot curve)', () => {
    const three = effectiveAspect(3);
    const six = effectiveAspect(6);
    // points 4-6 add far less than points 1-3 (the ED cliff)
    expect(six - three).toBeLessThan(three);
    expect(effectiveAspect(1)).toBeCloseTo(1.0);
  });

  it('a balanced spread beats a dumped stack at equal points', () => {
    const dumped = resolveBudget({ power: 6 }, 6);
    const spread = resolveBudget({ power: 2, speed: 2, area: 2 }, 6);
    const sum = (r: { effective: Record<string, number> }) => Object.values(r.effective).reduce((a, b) => a + b, 0);
    expect(sum(spread)).toBeGreaterThan(sum(dumped));
    expect(dumped.balanced).toBe(false);   // all in power
    expect(spread.balanced).toBe(true);
  });

  it('flags overspend', () => {
    expect(resolveBudget({ power: 4, speed: 4 }, 6).overspent).toBe(true);
    expect(resolveBudget({ power: 3, speed: 3 }, 6).overspent).toBe(false);
  });

  it('budget grows with tier', () => {
    expect(budgetForTier(1)).toBe(DEFAULT_BUDGET);
    expect(budgetForTier(5)).toBeGreaterThan(DEFAULT_BUDGET);
  });
});
