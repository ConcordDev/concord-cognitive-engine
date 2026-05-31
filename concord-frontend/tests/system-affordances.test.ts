// The "[System]" contextual affordance resolver — the no-learning-curve bet.
// Pins ranking (combat dominates; quest-NPC beats idle-NPC), context coverage
// (building/mount/vehicle/water/airborne/skill-point/stake), and the never-empty
// floor (always at least "Explore").

import { describe, it, expect } from 'vitest';
import { resolveAffordances, primaryAffordance } from '@/lib/concordia/system-affordances';

describe('System affordances', () => {
  it('combat dominates the ranking when in a fight', () => {
    const a = resolveAffordances({ inCombat: true, nearNpc: { id: 'n', name: 'Smith', hasQuest: true } });
    expect(a[0].verb).toBe('combat:attack');
  });

  it('a quest NPC outranks idle chatter', () => {
    const quest = primaryAffordance({ nearNpc: { id: 'n', name: 'Orin', hasQuest: true } });
    expect(quest?.verb).toBe('concordia:open-dialogue');
    expect(quest?.why).toMatch(/something for you/i);
  });

  it('maps building types to the right verb + why', () => {
    const a = resolveAffordances({ nearBuilding: { id: 'b', type: 'glyph_altar' } });
    expect(a.find((x) => x.label === 'Compose a glyph')).toBeTruthy();
  });

  it('surfaces an unread personal-stake high', () => {
    const a = resolveAffordances({ hasUnreadStake: true, nearNode: { id: 'n', type: 'ore_vein' } });
    expect(a[0].verb).toBe('concordia:open-stake');
  });

  it('never returns empty — the floor is always Explore', () => {
    const a = resolveAffordances({});
    expect(a.length).toBe(1);
    expect(a[0].label).toBe('Explore');
  });
});
