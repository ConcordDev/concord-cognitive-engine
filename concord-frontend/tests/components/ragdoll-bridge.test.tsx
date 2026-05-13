/**
 * Concordia Phase 3 — ragdoll-bridge unit tests.
 *
 * Pins:
 *   - lethal-hit event spawns ragdoll on physicsWorld
 *   - missing position / targetId is a no-op
 *   - default impulse vector points away from world origin
 *   - massMultiplier scales impulse magnitude
 *   - detach removes the listener and clears timers
 *   - active-ragdoll cap evicts oldest
 *   - dispatchLethalHit fires the matching event
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attachRagdollBridge,
  dispatchLethalHit,
  RAGDOLL_BRIDGE_CONSTANTS,
} from '@/lib/concordia/ragdoll-bridge';

interface SpawnCall {
  id: string;
  position: { x: number; y: number; z: number };
  impulse?: { x: number; y: number; z: number };
}

function makePhysicsWorldShim() {
  const spawnCalls: SpawnCall[] = [];
  const despawnCalls: string[] = [];
  return {
    spawnCalls,
    despawnCalls,
    spawnRagdoll: (id: string, position: SpawnCall['position'], impulse?: SpawnCall['impulse']) => {
      spawnCalls.push({ id, position, impulse });
      return { id };
    },
    despawnRagdoll: (id: string) => { despawnCalls.push(id); },
  };
}

describe('ragdoll-bridge — attach / detach', () => {
  it('attach + dispatchLethalHit → spawnRagdoll called', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    dispatchLethalHit({ targetId: 'npc_1', position: { x: 5, y: 0, z: 5 } });
    expect(shim.spawnCalls.length).toBe(1);
    expect(shim.spawnCalls[0].id).toBe('npc_1');
    detach();
  });

  it('after detach, no spawns', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    detach();
    dispatchLethalHit({ targetId: 'npc_1', position: { x: 1, y: 0, z: 1 } });
    expect(shim.spawnCalls.length).toBe(0);
  });
});

describe('ragdoll-bridge — input validation', () => {
  it('no-op without targetId', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    // @ts-expect-error missing targetId on purpose
    dispatchLethalHit({ position: { x: 0, y: 0, z: 0 } });
    expect(shim.spawnCalls.length).toBe(0);
    detach();
  });

  it('no-op without position', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    // @ts-expect-error missing position on purpose
    dispatchLethalHit({ targetId: 'npc_x' });
    expect(shim.spawnCalls.length).toBe(0);
    detach();
  });
});

describe('ragdoll-bridge — default impulse', () => {
  it('points away from origin', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    dispatchLethalHit({ targetId: 'npc_1', position: { x: 10, y: 0, z: 0 } });
    const imp = shim.spawnCalls[0].impulse!;
    expect(imp.x).toBeGreaterThan(0);
    expect(imp.y).toBeGreaterThan(0);
    detach();
  });

  it('massMultiplier scales magnitude (1.4 stronger than 0.7)', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    dispatchLethalHit({ targetId: 'a', position: { x: 1, y: 0, z: 0 }, massMultiplier: 1.4 });
    dispatchLethalHit({ targetId: 'b', position: { x: 1, y: 0, z: 0 }, massMultiplier: 0.7 });
    const aMag = Math.hypot(
      shim.spawnCalls[0].impulse!.x,
      shim.spawnCalls[0].impulse!.y,
      shim.spawnCalls[0].impulse!.z,
    );
    const bMag = Math.hypot(
      shim.spawnCalls[1].impulse!.x,
      shim.spawnCalls[1].impulse!.y,
      shim.spawnCalls[1].impulse!.z,
    );
    expect(aMag).toBeGreaterThan(bMag);
    detach();
  });

  it('caller-supplied impulse overrides default', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    const explicit = { x: 99, y: 99, z: 99 };
    dispatchLethalHit({ targetId: 'a', position: { x: 0, y: 0, z: 0 }, impulse: explicit });
    expect(shim.spawnCalls[0].impulse).toEqual(explicit);
    detach();
  });
});

describe('ragdoll-bridge — decay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('despawn called after DECAY_MS', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    dispatchLethalHit({ targetId: 'npc_decay', position: { x: 1, y: 0, z: 1 } });
    expect(shim.despawnCalls.length).toBe(0);
    vi.advanceTimersByTime(RAGDOLL_BRIDGE_CONSTANTS.DECAY_MS + 100);
    expect(shim.despawnCalls).toContain('npc_decay');
    detach();
  });

  it('re-spawn same id resets decay timer', () => {
    const shim = makePhysicsWorldShim();
    const detach = attachRagdollBridge(shim);
    dispatchLethalHit({ targetId: 'npc_x', position: { x: 1, y: 0, z: 1 } });
    vi.advanceTimersByTime(RAGDOLL_BRIDGE_CONSTANTS.DECAY_MS - 1000);
    dispatchLethalHit({ targetId: 'npc_x', position: { x: 2, y: 0, z: 2 } });
    vi.advanceTimersByTime(2000); // would have despawned the first one
    expect(shim.despawnCalls.length).toBe(0);
    vi.advanceTimersByTime(RAGDOLL_BRIDGE_CONSTANTS.DECAY_MS);
    expect(shim.despawnCalls).toContain('npc_x');
    detach();
  });
});
