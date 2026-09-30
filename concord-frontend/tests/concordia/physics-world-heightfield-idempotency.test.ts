/**
 * Regression coverage for a live World Lens crash traced this session via a
 * Playwright script that captured full stack traces (prior diagnostic
 * attempts only had bare `.message` strings, which weren't enough to find
 * the real site): a "memory access out of bounds" RuntimeError inside
 * RAPIER's WASM `createCollider`, called from
 * `PhysicsWorld.createHeightfieldCollider` — followed by every subsequent
 * world-touching call panicking with "recursive use of an object detected
 * which would lead to unsafe aliasing in rust" (the WASM heap is corrupted
 * once the first fault lands).
 *
 * Root cause: `components/world/WorldOsSurface.tsx` passed TerrainRenderer two
 * unstable-identity props — `lodCenter={{ x: 0, z: 0 }}` (a fresh object
 * literal every render) and `districts={deriveTerrainZones(worldBuildings)}`
 * (recomputed every render even when `worldBuildings` hadn't changed). Both
 * sit in TerrainRenderer's terrain-build `useEffect` dependency array, so on
 * this HUD-heavy page the effect re-fired on nearly every render, dispatching
 * `concordia:terrain-ready` again each time. `createHeightfieldCollider` had
 * no idempotency guard — unlike its sibling `rebuildHeightfieldWithDeltas`,
 * which correctly removes the prior `_terrainCollider` before creating a
 * replacement — so every re-fire piled up an additional heightfield collider
 * in the same Rapier world without ever removing the old one.
 *
 * Fixed on both ends: the page now memoizes `districts`/`lodCenter` so the
 * effect only re-fires when `worldBuildings` actually changes, AND
 * `createHeightfieldCollider` itself is now idempotent (defense in depth —
 * any other caller that re-dispatches terrain-ready, e.g. a legitimate
 * quality change, must not leak colliders either).
 *
 * Uses the REAL @dimforge/rapier3d-compat WASM module (same pattern as
 * physics-world-projectile-hit.test.ts and physics-world-ragdoll.test.ts) —
 * the crash is a real WASM heap fault, not observable against a mock.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { physicsWorld } from '@/lib/world-lens/physics-world';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawWorld(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (physicsWorld as any).world;
}

function makeHeightmap(width: number, height: number): Float32Array {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = 0.5;
  return data;
}

describe('physics-world — createHeightfieldCollider idempotency (real Rapier)', () => {
  beforeEach(async () => {
    physicsWorld.destroy();
    await physicsWorld.init();
  });

  afterAll(() => {
    physicsWorld.destroy();
  });

  it('does not throw when the terrain-ready event fires repeatedly with the same data (the crash precondition)', () => {
    // Mirrors TerrainRenderer re-firing its build effect many times because
    // a parent re-render handed it new-identity `districts`/`lodCenter`
    // props — the exact real-world trigger this session traced.
    const hm = makeHeightmap(64, 64);
    expect(() => {
      for (let i = 0; i < 20; i++) {
        physicsWorld.createHeightfieldCollider(hm, 64, 64, { x: 2000, y: 80, z: 2000 });
      }
    }).not.toThrow();
  });

  it('replaces the prior heightfield collider instead of leaking a duplicate each call', () => {
    const w = rawWorld();
    const hm = makeHeightmap(32, 32);

    physicsWorld.createHeightfieldCollider(hm, 32, 32, { x: 2000, y: 80, z: 2000 });
    const afterFirst = w.colliders.len();

    physicsWorld.createHeightfieldCollider(hm, 32, 32, { x: 2000, y: 80, z: 2000 });
    const afterSecond = w.colliders.len();

    physicsWorld.createHeightfieldCollider(hm, 32, 32, { x: 2000, y: 80, z: 2000 });
    const afterThird = w.colliders.len();

    // One collider registered, never accumulating — each re-fire replaces
    // the previous heightfield rather than adding a sibling.
    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(afterFirst);
    expect(afterThird).toBe(afterFirst);
  });

  it('the world keeps stepping cleanly after many terrain-ready re-fires (no corrupted WASM state)', () => {
    const hm = makeHeightmap(48, 48);
    for (let i = 0; i < 10; i++) {
      physicsWorld.createHeightfieldCollider(hm, 48, 48, { x: 2000, y: 80, z: 2000 });
    }
    physicsWorld.createCharacterController('npc_after_thrash');
    expect(() => physicsWorld.step(0.016)).not.toThrow();
  });
});
