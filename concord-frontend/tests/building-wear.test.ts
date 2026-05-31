// Track 3 — persistent building wear. Pins the pure scar reducer the
// BuildingWearLayer holds: damage records a scar, repair clears it, collapse is
// the terminal mark that a later damage event can't downgrade, marks persist
// across unrelated events, and id-less events are ignored.
//
// Run: npx vitest run tests/building-wear.test.ts

import { describe, it, expect } from 'vitest';
import { applyWearEvent, wearStyle, type WearMark } from '../lib/concordia/building-wear';

const empty = () => new Map<string, WearMark>();

describe('applyWearEvent', () => {
  it('records a crack scar on standing→damaged', () => {
    const m = applyWearEvent(empty(), { buildingId: 'b1', toState: 'damaged', position: { x: 5, y: 0, z: 9 } });
    expect(m.get('b1')).toMatchObject({ buildingId: 'b1', level: 'damaged', x: 5, z: 9 });
  });

  it('clears the scar on repair (→standing)', () => {
    let m = applyWearEvent(empty(), { buildingId: 'b1', toState: 'damaged', position: { x: 1, z: 2 } });
    m = applyWearEvent(m, { buildingId: 'b1', toState: 'standing' });
    expect(m.has('b1')).toBe(false);
  });

  it('upgrades damaged→collapsed', () => {
    let m = applyWearEvent(empty(), { buildingId: 'b1', toState: 'damaged', position: { x: 1, z: 2 } });
    m = applyWearEvent(m, { buildingId: 'b1', toState: 'collapsed', position: { x: 1, z: 2 } });
    expect(m.get('b1')?.level).toBe('collapsed');
  });

  it('does NOT downgrade a collapsed scar back to damaged', () => {
    let m = applyWearEvent(empty(), { buildingId: 'b1', toState: 'collapsed', position: { x: 1, z: 2 } });
    m = applyWearEvent(m, { buildingId: 'b1', toState: 'damaged', position: { x: 1, z: 2 } });
    expect(m.get('b1')?.level).toBe('collapsed');
  });

  it('keeps the prior position when a transition omits one', () => {
    let m = applyWearEvent(empty(), { buildingId: 'b1', toState: 'damaged', position: { x: 7, y: 1, z: 3 } });
    m = applyWearEvent(m, { buildingId: 'b1', toState: 'collapsed' });
    expect(m.get('b1')).toMatchObject({ x: 7, z: 3, level: 'collapsed' });
  });

  it('persists unrelated scars and is pure (new map each call)', () => {
    const a = applyWearEvent(empty(), { buildingId: 'b1', toState: 'damaged', position: { x: 0, z: 0 } });
    const b = applyWearEvent(a, { buildingId: 'b2', toState: 'collapsed', position: { x: 1, z: 1 } });
    expect(b).not.toBe(a);
    expect(b.size).toBe(2);
    expect(a.size).toBe(1); // original untouched
  });

  it('ignores events with no id or no toState', () => {
    const m0 = empty();
    expect(applyWearEvent(m0, { toState: 'damaged' }).size).toBe(0);
    expect(applyWearEvent(m0, { buildingId: 'b1' }).size).toBe(0);
  });
});

describe('wearStyle', () => {
  it('collapsed reads heavier than damaged', () => {
    expect(wearStyle('collapsed').radius).toBeGreaterThan(wearStyle('damaged').radius);
    expect(wearStyle('collapsed').streaks).toBeGreaterThan(wearStyle('damaged').streaks);
  });
});
