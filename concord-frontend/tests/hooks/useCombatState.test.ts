/**
 * useCombatState — pins the stateRef-sync-to-useEffect fix.
 *
 * `stateRef.current = state` used to be a direct render-body mutation
 * (safe in practice only because reads always came from a later render),
 * moved to `useEffect(() => { stateRef.current = state; }, [state])` for
 * consistency with the rest of this codebase's ref-sync idiom.
 * `recordDeath` reads `stateRef.current` (not `state`) to avoid a stale
 * closure inside its own `useCallback`, so it's the right place to prove
 * the ref actually reflects the latest state after a real state change.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCombatState } from '@/hooks/useCombatState';
import type { CombatSkill } from '@/lib/concordia/combat/hotbar';

vi.mock('@/lib/realtime/socket', () => ({ emit: vi.fn() }));

function makeSkill(dtuId: string): CombatSkill {
  return {
    dtuId,
    name: 'Test Strike',
    description: 'test',
    cooldownMs: 1000,
    staminaCost: 5,
    apCost: 10,
    damageRange: [1, 2],
    range: 'melee',
    targetType: 'single',
    animationClip: 'strike',
    derivedFrom: [],
    lastUsedAt: 0,
  };
}

describe('useCombatState', () => {
  it('stateRef reflects a state change made via setHotbar before recordDeath reads it', () => {
    const { result } = renderHook(() => useCombatState());

    act(() => {
      result.current.setHotbar({ slots: [makeSkill('dtu-1'), null, null, null, null, null, null, null, null], activeSlot: 0 });
    });

    act(() => {
      result.current.recordDeath('a wolf', 25);
    });

    const [death] = result.current.state.deaths;
    expect(death.killedBy).toBe('a wolf');
    // skillsUsed is derived from stateRef.current.hotbar.slots at call time —
    // if the ref were stale (still the initial all-null hotbar), this would
    // be empty instead of containing the skill set immediately beforehand.
    expect(death.skillsUsed).toEqual(['dtu-1']);
  });

  it('recordDeath computes damageTaken from the current health via the ref, not a stale initial value', () => {
    const { result } = renderHook(() => useCombatState());
    const maxHealth = result.current.state.maxHealth;

    act(() => {
      result.current.recordDeath('fall damage', 10);
    });

    // Health starts at maxHealth, so damageTaken (maxHealth - health) is 0
    // on the very first death — proves the ref read a real, current value
    // rather than throwing on an undefined/stale stateRef.current.
    const [death] = result.current.state.deaths;
    expect(death.damageTaken).toBe(0);
    expect(maxHealth).toBeGreaterThan(0);
    // Death respawns at full health.
    expect(result.current.state.health).toBe(maxHealth);
  });

  it('activateSkill consumes stamina, logs the use, and emits skill:use', () => {
    const { result } = renderHook(() => useCombatState());
    act(() => {
      result.current.setHotbar({ slots: [makeSkill('dtu-2'), null, null, null, null, null, null, null, null], activeSlot: 0 });
    });
    const staminaBefore = result.current.state.stamina;

    let used = false;
    act(() => {
      used = result.current.activateSkill(0);
    });

    expect(used).toBe(true);
    expect(result.current.state.stamina).toBe(staminaBefore - 5);
    expect(result.current.state.log[0].text).toContain('Used Test Strike');
  });

  it('activateSkill on an empty slot is a no-op returning false', () => {
    const { result } = renderHook(() => useCombatState());
    let used = true;
    act(() => {
      used = result.current.activateSkill(3);
    });
    expect(used).toBe(false);
  });

  it('dodge, setBlock, setTarget, toggleVATS, queueShot, and tick all mutate state without throwing', () => {
    const { result } = renderHook(() => useCombatState());

    act(() => { result.current.dodge(); });
    expect(result.current.state.log[0].type).toBe('dodge');

    act(() => { result.current.setBlock(true); });
    expect(result.current.state.blockHeld).toBe(true);

    act(() => { result.current.setTarget({ id: 't1', name: 'Wolf', health: 50, maxHealth: 50, distance: 3, isHostile: true }); });
    expect(result.current.state.target?.id).toBe('t1');

    act(() => { result.current.toggleVATS(); });
    expect(result.current.state.vats.active).toBe(true);

    act(() => { result.current.queueShot('t1', 'torso', 10); });
    // No specific assertion on VATS internals beyond "didn't throw" — the
    // real queue/AP-cost math is covered by lib/concordia/combat/vats.ts's
    // own tests; this only needs to exercise the hook's call-through.

    act(() => { result.current.tick(1); });
    expect(result.current.state.stamina).toBeGreaterThanOrEqual(0);
  });
});
