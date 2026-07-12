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
import { render, waitFor } from '@testing-library/react';

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

// finding #7 — BuildingCollapseBridge can't reach ConcordiaScene's
// removeBuilding()/useConcordiaScene() (see the doc comment in
// CombatBridges.tsx for why: it mounts as a sibling of <ConcordiaScene>, not
// a descendant of its context Provider). It instead removes the collapsed
// building's Rapier collider directly via the `physicsWorld` singleton
// (dynamically imported, deterministic `building:box:${buildingId}` key —
// see the doc comment in CombatBridges.tsx for why it's double-prefixed)
// and, when a live scene has been cached via the concordia:scene-ready
// handshake, detaches the matching mesh group too. Mock both collaborators
// the same way `subscribe` is mocked above.
const { physicsRemoveBuildingColliderMock } = vi.hoisted(() => ({
  physicsRemoveBuildingColliderMock: vi.fn(),
}));
vi.mock('@/lib/world-lens/physics-world', () => ({
  physicsWorld: { removeBuildingCollider: physicsRemoveBuildingColliderMock },
}));

import { BuildingCollapseBridge } from '@/components/world/CombatBridges';

function fireWorldBuildingState(payload: unknown) {
  subscribeHandlers.get('world:building-state')!(payload);
}

describe('BuildingCollapseBridge — concordia:building-state re-shape', () => {
  beforeEach(() => {
    subscribeHandlers.clear();
    physicsRemoveBuildingColliderMock.mockClear();
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

  // finding #7 (runtime-health-capability-map.md) — a collapsed building
  // used to leave a permanent invisible wall: BuildingWearLayer/
  // BuildingCollapseVFX are purely presentational and never touched the
  // real mesh or its Rapier collider. These two tests pin the actual fix.
  describe('finding #7 — collapsed buildings are actually removed', () => {
    it('removes the Rapier collider via physicsWorld with the real building:box:<id> key on collapse', async () => {
      render(<BuildingCollapseBridge userId="u1" />);

      fireWorldBuildingState({
        worldId: 'concordia-hub', buildingId: 'bldg_7', state: 'collapsed',
        healthPct: 0, position: { x: 5, z: 6 }, attackerId: 'u1',
      });

      await waitFor(() => {
        // Matches physics-world.ts's real key generation: syncFromScene
        // builds `${profile}:${baseId}` (profile='box' for isBuilding
        // objects, baseId=buildingId) and hands that to
        // createBuildingCollider, which prefixes it again as
        // `building:${entityId}` — so the real key is double-prefixed, not
        // the single `box:${buildingId}` an earlier draft of this fix
        // assumed (which would have made this call a permanent no-op).
        expect(physicsRemoveBuildingColliderMock).toHaveBeenCalledWith('building:box:bldg_7');
      });
    });

    it('does NOT remove any collider for a standing→damaged transition', async () => {
      render(<BuildingCollapseBridge userId="u1" />);

      fireWorldBuildingState({
        worldId: 'concordia-hub', buildingId: 'bldg_7', state: 'damaged',
        healthPct: 0.5, position: { x: 5, z: 6 }, attackerId: 'u1',
      });

      // Give any (incorrect) async removal a chance to land before asserting
      // it never did.
      await new Promise((r) => setTimeout(r, 0));
      expect(physicsRemoveBuildingColliderMock).not.toHaveBeenCalled();
    });

    it('detaches the matching mesh group from the cached THREE.Scene on collapse', async () => {
      render(<BuildingCollapseBridge userId="u1" />);

      // Simulate ConcordiaScene's one-shot concordia:scene-ready broadcast
      // (the same handshake TreeLayer/RockLayer use) with a fake scene
      // graph containing the building's mesh group.
      const removeMock = vi.fn();
      const buildingGroup = {
        userData: { buildingId: 'bldg_9', isBuilding: true },
        parent: { remove: removeMock },
      };
      const otherGroup = {
        userData: { buildingId: 'bldg_other', isBuilding: true },
        parent: { remove: vi.fn() },
      };
      const fakeScene = {
        traverse: (cb: (child: typeof buildingGroup | typeof otherGroup) => void) => {
          cb(otherGroup);
          cb(buildingGroup);
        },
      };
      window.dispatchEvent(new CustomEvent('concordia:scene-ready', { detail: { scene: fakeScene } }));

      fireWorldBuildingState({
        worldId: 'concordia-hub', buildingId: 'bldg_9', state: 'collapsed',
        healthPct: 0, position: { x: 1, z: 1 }, attackerId: 'u1',
      });

      await waitFor(() => {
        expect(removeMock).toHaveBeenCalledWith(buildingGroup);
      });
      expect(otherGroup.parent.remove).not.toHaveBeenCalled();
    });
  });
});
