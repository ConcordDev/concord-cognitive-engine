// Track 1 — damage-number grouping. Pins the pure merge core: numeric same-spot
// hits within the window+radius coalesce into one running tally (+count); kills
// and non-numeric labels never merge; the cap holds; the ×N label renders.
//
// Run: npx vitest run tests/damage-stack.test.ts

import { describe, it, expect } from 'vitest';
import { mergeDamage, dmgLabel, type DmgEntry } from '../lib/concordia/damage-stack';

const base = (over: Partial<Omit<DmgEntry, 'count'>> = {}): Omit<DmgEntry, 'count'> => ({
  id: 'a', x: 0, y: 1, z: 0, value: '10', kind: 'hit', bornAt: 1000, ...over,
});

describe('mergeDamage', () => {
  it('coalesces two same-spot numeric hits inside the window into one tally', () => {
    const first = mergeDamage([], base({ id: 'a', value: '10', bornAt: 1000 }));
    expect(first).toHaveLength(1);
    expect(first[0].count).toBe(1);

    const merged = mergeDamage(first, base({ id: 'b', value: '7', bornAt: 1500 }));
    expect(merged).toHaveLength(1);            // merged, not appended
    expect(merged[0].value).toBe('17');        // summed
    expect(merged[0].count).toBe(2);
    expect(merged[0].bornAt).toBe(1500);       // lifetime reset to the latest hit
  });

  it('escalates kind to crit when a crit lands in the tally', () => {
    const first = mergeDamage([], base({ value: '10', kind: 'hit', bornAt: 1000 }));
    const merged = mergeDamage(first, base({ value: '20', kind: 'crit', bornAt: 1200 }));
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('crit');
    expect(merged[0].value).toBe('30');
  });

  it('does NOT merge past the time window', () => {
    const first = mergeDamage([], base({ value: '10', bornAt: 1000 }));
    const next = mergeDamage(first, base({ value: '7', bornAt: 4000 }), { groupMs: 2000 });
    expect(next).toHaveLength(2);
  });

  it('does NOT merge outside the radius', () => {
    const first = mergeDamage([], base({ x: 0, z: 0, value: '10', bornAt: 1000 }));
    const next = mergeDamage(first, base({ x: 10, z: 0, value: '7', bornAt: 1100 }), { radiusM: 1.5 });
    expect(next).toHaveLength(2);
  });

  it('never merges kills or non-numeric labels', () => {
    const a = mergeDamage([], base({ value: 'PARRY', kind: 'block', bornAt: 1000 }));
    const b = mergeDamage(a, base({ value: 'PARRY', kind: 'block', bornAt: 1100 }));
    expect(b).toHaveLength(2);

    const c = mergeDamage([], base({ value: '50', kind: 'kill', bornAt: 1000 }));
    const d = mergeDamage(c, base({ value: '50', kind: 'kill', bornAt: 1100 }));
    expect(d).toHaveLength(2);
  });

  it('caps the list length', () => {
    let list: DmgEntry[] = [];
    for (let i = 0; i < 50; i++) {
      // spread far apart so nothing merges
      list = mergeDamage(list, base({ id: `e${i}`, x: i * 5, value: 'PARRY', kind: 'block', bornAt: 1000 + i }), { max: 32 });
    }
    expect(list.length).toBe(32);
  });
});

describe('dmgLabel', () => {
  it('shows ×N only when the tally is > 1', () => {
    expect(dmgLabel({ id: 'a', x: 0, y: 0, z: 0, value: '10', kind: 'hit', bornAt: 0, count: 1 })).toBe('10');
    expect(dmgLabel({ id: 'a', x: 0, y: 0, z: 0, value: '42', kind: 'crit', bornAt: 0, count: 5 })).toBe('42 ×5');
  });
});
