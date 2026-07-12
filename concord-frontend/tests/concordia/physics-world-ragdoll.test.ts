/**
 * Runtime-health finding #6 (docs/concordia-specs/runtime-health-capability-map.md
 * §6) — regression coverage for the ragdoll leak fix in
 * lib/world-lens/physics-world.ts.
 *
 * Uses the REAL @dimforge/rapier3d-compat WASM module (already a project
 * dependency, and its "-compat" build inlines the wasm as base64 so it
 * inits fine under vitest/jsdom without a fetch()) rather than a mock —
 * this is plain deterministic physics-body bookkeeping, so a genuine
 * integration test is both possible and more trustworthy than asserting
 * against a stub.
 *
 * Pins:
 *   - removeRagdoll frees every tracked body and drops the Map entry
 *   - spawning a ragdoll for an id that already has a live tracked entry
 *     disposes the prior entry first (no orphaned bodies/joints)
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { physicsWorld } from '@/lib/world-lens/physics-world';

// Rapier internals (`world`) are a private class field at the TS level only
// — accessing them from a test to assert on raw body counts is the
// standard escape hatch for verifying "did the underlying engine actually
// free the resource," not just "did our tracking Map shrink."
function rawBodyCount(): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = (physicsWorld as any).world;
  return w ? w.bodies.len() : 0;
}

const RAGDOLL_SEGMENT_COUNT = 7; // torso, head, hips, 2 thighs, 2 arms

describe('physics-world — ragdoll lifecycle (real Rapier)', () => {
  beforeEach(async () => {
    physicsWorld.destroy();
    await physicsWorld.init();
  });

  afterAll(() => {
    physicsWorld.destroy();
  });

  it('spawnRagdoll creates a tracked handle with 7 bodies', () => {
    const handle = physicsWorld.spawnRagdoll('npc_a', { x: 0, y: 5, z: 0 });
    expect(handle).not.toBeNull();
    expect(handle!.bodies.length).toBe(RAGDOLL_SEGMENT_COUNT);
    expect(physicsWorld.getRagdollIds()).toEqual(['npc_a']);
    expect(rawBodyCount()).toBe(RAGDOLL_SEGMENT_COUNT);
  });

  it('removeRagdoll frees the bodies and drops the tracking entry', () => {
    physicsWorld.spawnRagdoll('npc_b', { x: 0, y: 5, z: 0 });
    expect(rawBodyCount()).toBe(RAGDOLL_SEGMENT_COUNT);

    physicsWorld.removeRagdoll('npc_b');

    expect(physicsWorld.getRagdollIds()).not.toContain('npc_b');
    expect(rawBodyCount()).toBe(0);
  });

  it('removeRagdoll on an unknown id is a harmless no-op', () => {
    expect(() => physicsWorld.removeRagdoll('does_not_exist')).not.toThrow();
    expect(rawBodyCount()).toBe(0);
  });

  it('spawning a ragdoll for a REUSED id disposes the prior entry instead of orphaning it', () => {
    // Same NPC id dies twice (e.g. dies again after a respawn) without the
    // bridge ever calling removeRagdoll in between — this is exactly the
    // scenario the fix guards against.
    physicsWorld.spawnRagdoll('npc_reused', { x: 0, y: 5, z: 0 });
    expect(rawBodyCount()).toBe(RAGDOLL_SEGMENT_COUNT);

    physicsWorld.spawnRagdoll('npc_reused', { x: 10, y: 5, z: 10 });

    // Exactly one tracked ragdoll for the id, and the world only holds ONE
    // ragdoll's worth of bodies — the first spawn's 7 bodies must have been
    // freed, not left dangling as untracked/unfreeable garbage.
    expect(physicsWorld.getRagdollIds()).toEqual(['npc_reused']);
    expect(rawBodyCount()).toBe(RAGDOLL_SEGMENT_COUNT);
  });

  it('multiple distinct ids each keep their own bodies (no cross-id disposal)', () => {
    physicsWorld.spawnRagdoll('npc_x', { x: 0, y: 5, z: 0 });
    physicsWorld.spawnRagdoll('npc_y', { x: 5, y: 5, z: 5 });

    expect(physicsWorld.getRagdollIds().sort()).toEqual(['npc_x', 'npc_y']);
    expect(rawBodyCount()).toBe(RAGDOLL_SEGMENT_COUNT * 2);

    physicsWorld.removeRagdoll('npc_x');
    expect(physicsWorld.getRagdollIds()).toEqual(['npc_y']);
    expect(rawBodyCount()).toBe(RAGDOLL_SEGMENT_COUNT);
  });
});
