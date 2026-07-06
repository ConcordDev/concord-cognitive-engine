/**
 * Fix 6 (verification audit, 2026-07-05) — BuildingCollapseBridge's
 * `concordia:building-state` re-shape + dispatch.
 *
 * BuildingWearLayer.tsx and BuildingCollapseVFX.tsx both listen for a
 * `concordia:building-state` window CustomEvent shaped
 * `{buildingId, toState, position:{x,y,z}, worldId}` (lib/concordia/building-wear.ts's
 * BuildingStateEvent) — but nothing dispatched that event. The real socket
 * event, `world:building-state` (routes/worlds.js:2998), is shaped
 * `{worldId, buildingId, state, healthPct, position:{x,z}, attackerId}` — a
 * different field name (`state` vs `toState`) and no `position.y`.
 * BuildingCollapseBridge (CombatBridges.tsx) subscribes to the real socket
 * event but used to only ever dispatch a differently-named
 * `concordia:building-collapse` event, and only for the collapsed
 * transition — so both consumers were dead for every transition.
 *
 * Fixed: the bridge now ALSO dispatches `concordia:building-state` (re-shaped
 * to the consumers' expected fields) for every transition (standing / damaged
 * / collapsed), while the pre-existing `concordia:building-collapse` dispatch
 * (consumed by lib/event-router.ts's toast) is preserved unchanged for the
 * collapsed case only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const { subscribeHandlers, subscribeMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    subscribeHandlers: handlers,
    subscribeMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  };
});
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: subscribeMock,
}));

import { BuildingCollapseBridge } from '@/components/world/CombatBridges';

function fireWorldBuildingState(payload: unknown) {
  subscribeHandlers.get('world:building-state')!(payload);
}

describe('BuildingCollapseBridge — concordia:building-state re-shape', () => {
  beforeEach(() => {
    subscribeHandlers.clear();
  });

  it('subscribes to the real server event world:building-state', () => {
    render(<BuildingCollapseBridge userId="u1" />);
    expect(subscribeMock).toHaveBeenCalledWith('world:building-state', expect.any(Function));
  });

  it('dispatches concordia:building-state (re-shaped) on a standing→damaged transition', () => {
    render(<BuildingCollapseBridge userId="u1" />);
    const seen: Array<Record<string, unknown>> = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('concordia:building-state', listener);

    fireWorldBuildingState({
      worldId: 'concordia-hub', buildingId: 'bldg_1', state: 'damaged',
      healthPct: 0.6, position: { x: 10, z: 20 }, attackerId: 'u2',
    });
    window.removeEventListener('concordia:building-state', listener);

    expect(seen).toHaveLength(1);
    // Field mapping: `state` → `toState`; position.y defaults to 0 since the
    // server payload doesn't carry it.
    expect(seen[0]).toEqual({
      buildingId: 'bldg_1',
      worldId: 'concordia-hub',
      toState: 'damaged',
      position: { x: 10, y: 0, z: 20 },
    });
  });

  it('also dispatches concordia:building-state on collapse, alongside the pre-existing concordia:building-collapse dispatch', () => {
    render(<BuildingCollapseBridge userId="u1" />);
    const stateEvents: Array<Record<string, unknown>> = [];
    const collapseEvents: Array<Record<string, unknown>> = [];
    const onState = (e: Event) => stateEvents.push((e as CustomEvent).detail);
    const onCollapse = (e: Event) => collapseEvents.push((e as CustomEvent).detail);
    window.addEventListener('concordia:building-state', onState);
    window.addEventListener('concordia:building-collapse', onCollapse);

    fireWorldBuildingState({
      worldId: 'concordia-hub', buildingId: 'bldg_1', state: 'collapsed',
      healthPct: 0, position: { x: 1, z: 2 }, attackerId: 'u1',
    });

    window.removeEventListener('concordia:building-state', onState);
    window.removeEventListener('concordia:building-collapse', onCollapse);

    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0].toState).toBe('collapsed');
    // The pre-existing collapse-only dispatch (toast + screen-shake) is
    // untouched — still fires exactly once for the collapsed transition.
    expect(collapseEvents).toHaveLength(1);
    expect(collapseEvents[0].buildingId).toBe('bldg_1');
  });

  it('does NOT dispatch concordia:building-collapse for a non-collapsed transition', () => {
    render(<BuildingCollapseBridge userId="u1" />);
    const collapseEvents: unknown[] = [];
    const onCollapse = (e: Event) => collapseEvents.push((e as CustomEvent).detail);
    window.addEventListener('concordia:building-collapse', onCollapse);

    fireWorldBuildingState({ worldId: 'concordia-hub', buildingId: 'bldg_1', state: 'damaged', position: { x: 0, z: 0 } });

    window.removeEventListener('concordia:building-collapse', onCollapse);
    expect(collapseEvents).toHaveLength(0);
  });

  it('dispatches on repair (→standing) too, so BuildingWearLayer can clear its scar', () => {
    render(<BuildingCollapseBridge userId="u1" />);
    const seen: Array<Record<string, unknown>> = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('concordia:building-state', listener);

    fireWorldBuildingState({ worldId: 'concordia-hub', buildingId: 'bldg_1', state: 'standing', position: { x: 3, z: 4 } });

    window.removeEventListener('concordia:building-state', listener);
    expect(seen).toEqual([{ buildingId: 'bldg_1', worldId: 'concordia-hub', toState: 'standing', position: { x: 3, y: 0, z: 4 } }]);
  });
});
