import { describe, it, expect } from 'vitest';
import { harvestProgressPct } from '@/components/agriculture/harvestProgress';
import { courtshipActions } from '@/components/courtship/CourtshipsPanel';

describe('harvest progress', () => {
  it('does not count a planned lot toward the harvest', () => {
    expect(harvestProgressPct([{ status: 'planned', quantity: 100 }], 100)).toBe(0);
    expect(harvestProgressPct([{ status: 'harvested', quantity: 25 }], 100)).toBe(25);
  });
});

describe('courtship actions', () => {
  it('offers Propose on an estranged courtship once affinity clears the engage line', () => {
    const high = courtshipActions('estranged', 0.93, 0.7, 0.85, 70);
    expect(high.canPropose).toBe(true);
    expect(high.hint).toBeNull();
    const low = courtshipActions('estranged', 0.4, 0.7, 0.85, 70);
    expect(low.canPropose).toBe(false);
    expect(low.hint).toMatch(/estranged/);
    expect(low.hint).not.toMatch(/^Reach /);
  });

  it('does not offer Propose on a widowed courtship', () => {
    const row = courtshipActions('widowed', 1, 0.7, 0.85, 70);
    expect(row.canPropose).toBe(false);
    expect(row.canWed).toBe(false);
  });
});
