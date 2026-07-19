/**
 * Regression coverage for two bugs in
 * lib/world-lens/physics-world.ts#stepProjectiles, both found chasing the
 * same CI crash (E2E Core perf.spec.ts timing out on 2026-07-06 and
 * 2026-07-19 — chrome-headless-shell SEGV_ACCERR preceded by "recursive use
 * of an object detected which would lead to unsafe aliasing in rust").
 *
 * Uses the REAL @dimforge/rapier3d-compat WASM module (same pattern as
 * physics-world-ragdoll.test.ts) rather than a mock — both bugs are only
 * observable against a real Rapier instance.
 *
 * Bug 1 (the crash): stepProjectiles() called `this.world.intersectionPair`
 * from INSIDE a `this.world.forEachCollider` callback. forEachCollider
 * holds a Rust-side borrow of the world's collider set for the duration of
 * its callback; calling another world-borrowing method from inside it is a
 * recursive/re-entrant borrow, which wasm-bindgen's runtime check panics
 * on. This crashed the whole renderer process rather than surfacing as a
 * catchable JS exception, so a try/catch around the call site would not
 * have caught it — the only real test is exercising the exact
 * forEachCollider + intersectionPair sequence against a real Rapier world
 * with a non-projectile collider present (an empty world never entered the
 * callback body, which is why this went unnoticed before).
 *
 * Bug 2 (silently wrong hit detection, found while fixing bug 1):
 * `this.world.getCollider(0)` does not mean "this projectile's own
 * collider" — Rapier collider handles are not small sequential integers
 * (confirmed empirically: two colliders in a fresh world had handles 0 and
 * 5e-324), so `getCollider(0)` returns whatever collider happens to hold
 * literal handle 0 in the WHOLE world, never reliably the projectile
 * currently being processed. Every intersection check was silently testing
 * against the wrong object. Fixed by capturing the collider
 * spawnProjectile actually creates and storing it on the projectile
 * record.
 *
 * Pins:
 *   - stepProjectiles does not throw when the world has a non-projectile
 *     collider present (bug 1's exact crash precondition)
 *   - a projectile overlapping a tagged entity's collider fires onHit
 *     against the RIGHT entity (bug 2 — this would have failed against the
 *     pre-fix `getCollider(0)` lookup even without the crash)
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { physicsWorld } from '@/lib/world-lens/physics-world';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawWorld(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (physicsWorld as any).world;
}

describe('physics-world — stepProjectiles hit detection (real Rapier)', () => {
  beforeEach(async () => {
    physicsWorld.destroy();
    await physicsWorld.init();
  });

  afterAll(() => {
    physicsWorld.destroy();
  });

  it('does not throw when a non-projectile collider is present in the world (the crash precondition)', () => {
    // A character controller creates a body + collider — the "other
    // collider" the forEachCollider scan must walk past without
    // re-entering the world.
    physicsWorld.createCharacterController('npc_bystander');

    const projId = physicsWorld.spawnProjectile({
      position: { x: 0, y: 5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      ownerId: 'player_1',
    });
    expect(projId).not.toBeNull();

    expect(() => physicsWorld.stepProjectiles(performance.now())).not.toThrow();
  });

  it('a projectile overlapping a tagged entity fires onHit against that entity', () => {
    physicsWorld.createCharacterController('npc_target');
    // Rapier's RigidBody.userData is what stepProjectiles reads to resolve
    // the struck entity — set directly on the raw body, mirroring how a
    // real caller (combat bridge) tags spawned entities. The character
    // controller is the first body created in this fresh world, so it's
    // reliably body handle 0.
    const w = rawWorld();
    const body = w.getRigidBody(0);
    body.userData = { entityId: 'npc_target' };

    const hits: string[] = [];
    physicsWorld.spawnProjectile({
      // Same position physics-world.ts spawns character controllers at, so
      // the projectile's ball collider overlaps the capsule immediately.
      position: { x: 0, y: 5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      ownerId: 'player_1',
      onHit: (entityId) => hits.push(entityId),
    });

    // intersectionPair queries Rapier's broad-phase spatial structures,
    // which are only populated after at least one world.step() — matching
    // real usage (the host scene calls step() then stepProjectiles() each
    // frame).
    physicsWorld.step(0.016);
    physicsWorld.stepProjectiles(performance.now());

    expect(hits).toEqual(['npc_target']);
  });

  it("does not hit the projectile's own owner", () => {
    physicsWorld.createCharacterController('player_shooter');
    const w = rawWorld();
    const body = w.getRigidBody(0);
    body.userData = { entityId: 'player_shooter' };

    const hits: string[] = [];
    physicsWorld.spawnProjectile({
      position: { x: 0, y: 5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      ownerId: 'player_shooter',
      onHit: (entityId) => hits.push(entityId),
    });

    physicsWorld.step(0.016);
    physicsWorld.stepProjectiles(performance.now());

    expect(hits).toEqual([]);
  });
});
