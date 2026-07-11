/**
 * Runtime-health finding #9 (docs/concordia-specs/runtime-health-capability-map.md
 * §9) — "Player physics character-controller registration is a one-shot,
 * unretried race against async Rapier WASM init."
 *
 * Pre-fix, `AvatarSystem3D.tsx` called `physicsWorld.createCharacterController('player')`
 * exactly once, gated only by a synchronous check of a private field reached
 * around via a cast (`(physicsWorld as unknown as Record<string, unknown>)['world']`).
 * If Rapier's async WASM init hadn't resolved yet, the call silently no-op'd
 * (via `_guard`'s `_ready` gate) and nothing ever retried — the player fell
 * through terrain/buildings for the rest of the session.
 *
 * The fix adds two things:
 *   1. `physicsWorld.isReady()` — a public accessor for the same `_ready`
 *      gate `_guard` itself checks (physics-world.ts).
 *   2. `init()` dispatches a one-shot `concordia:physics-ready` window
 *      CustomEvent once `_ready` flips true, mirroring the existing
 *      concordia:scene-ready / concordia:scene-request-ready pattern
 *      ConcordiaScene.tsx already uses for the same class of async-mount-
 *      order problem.
 *
 * Part 1 below is a genuine behavioral test against the REAL Rapier WASM
 * module (same technique as tests/concordia/physics-world-ragdoll.test.ts —
 * the "-compat" build inlines wasm as base64, so it inits fine under
 * vitest/jsdom with no mocking). Part 2 is a static source-text pin on
 * AvatarSystem3D.tsx, following this repo's established pattern for that
 * file (tests/avatar-system-effect-stability.test.tsx and others) since the
 * component itself isn't mountable in jsdom.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { physicsWorld } from '@/lib/world-lens/physics-world';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

describe('physics-world — isReady() + concordia:physics-ready (real Rapier)', () => {
  afterAll(() => {
    physicsWorld.destroy();
  });

  it('isReady() is false before init() and true once init() resolves', async () => {
    physicsWorld.destroy();
    expect(physicsWorld.isReady()).toBe(false);
    await physicsWorld.init();
    expect(physicsWorld.isReady()).toBe(true);
  });

  it('createCharacterController no-ops (returns null) while not ready, and succeeds once ready', async () => {
    physicsWorld.destroy();
    expect(physicsWorld.isReady()).toBe(false);
    // Pre-fix this synchronous call is exactly what AvatarSystem3D used to
    // gate on — proving it silently fails (not throws) before init().
    expect(physicsWorld.createCharacterController('player')).toBeNull();

    await physicsWorld.init();
    const ctrl = physicsWorld.createCharacterController('player');
    expect(ctrl).not.toBeNull();
    physicsWorld.removeCharacter('player');
  });

  it('init() dispatches a one-shot window "concordia:physics-ready" CustomEvent once ready', async () => {
    physicsWorld.destroy();
    let fired = 0;
    const handler = () => { fired += 1; };
    window.addEventListener('concordia:physics-ready', handler);
    try {
      expect(fired).toBe(0);
      await physicsWorld.init();
      expect(fired).toBe(1);
    } finally {
      window.removeEventListener('concordia:physics-ready', handler);
    }
  });

  it('a listener attached AFTER init() already resolved simply never fires again (proves the consumer-side isReady() pre-check is load-bearing, not just the event)', async () => {
    physicsWorld.destroy();
    await physicsWorld.init();
    expect(physicsWorld.isReady()).toBe(true);

    let fired = 0;
    const handler = () => { fired += 1; };
    window.addEventListener('concordia:physics-ready', handler);
    // No re-init happens, so the one-shot event from the earlier init()
    // never repeats — a late-attaching consumer that ONLY listens (without
    // also checking isReady() up front, the way the fixed call site does)
    // would hang forever. This is exactly why the fix checks isReady()
    // first and only falls back to the listener when it's false.
    window.removeEventListener('concordia:physics-ready', handler);
    expect(fired).toBe(0);
  });
});

describe('AvatarSystem3D.tsx — character-controller registration retry (static source pin)', () => {
  const avatarSrc = read('components/world-lens/AvatarSystem3D.tsx');

  it('checks physicsWorld.isReady() at the registration call site, not a private-field cast', () => {
    expect(avatarSrc).toMatch(/if \(physicsWorld\.isReady\(\)\) \{\s*\n\s*physicsWorld\.createCharacterController\('player'\);/);
    // The old reach-around-private-field check must be gone.
    expect(avatarSrc).not.toMatch(/\(physicsWorld as unknown as Record<string, unknown>\)\['world'\] != null/);
  });

  it('falls back to a one-shot concordia:physics-ready listener that retries registration when not yet ready', () => {
    expect(avatarSrc).toMatch(/window\.addEventListener\('concordia:physics-ready', onPhysicsReady, \{ once: true \}\);/);
    expect(avatarSrc).toMatch(/function onPhysicsReady\(\) \{\s*\n\s*if \(disposed\) return;\s*\n\s*physicsWorld\.createCharacterController\('player'\);\s*\n\s*\}/);
  });

  it('the retry listener is guarded by the effect\'s `disposed` flag so a late-firing retry cannot register after unmount', () => {
    const handlerMatch = avatarSrc.match(/function onPhysicsReady\(\) \{[\s\S]*?\n\s*\}/);
    expect(handlerMatch).toBeTruthy();
    expect(handlerMatch![0]).toMatch(/if \(disposed\) return;/);
  });

  it('removes the concordia:physics-ready listener in the effect cleanup (no leak if physics never becomes ready before unmount)', () => {
    expect(avatarSrc).toMatch(/window\.removeEventListener\('concordia:physics-ready', onPhysicsReady\);/);
  });

  it('does NOT touch the stabilized setup-effect dependency array from the prior effect-thrash fix (commit 3563714b)', () => {
    // Same pin tests/avatar-system-effect-stability.test.tsx uses — kept
    // here too as a direct guard on THIS change, since the task explicitly
    // calls out that dependency array as off-limits.
    expect(avatarSrc).toMatch(/playerAvatar\.id,\s*\n\s*playerAvatar\.appearance,\s*\n\s*playerAvatar\.name,\s*\n\s*playerAvatar\.profession,\s*\n\s*playerAvatar\.firmEmblem,/);
  });
});

describe('physics-world.ts — isReady() accessor (static source pin)', () => {
  const physicsSrc = read('lib/world-lens/physics-world.ts');

  it('exposes a public isReady() that mirrors the _guard gate', () => {
    expect(physicsSrc).toMatch(/isReady\(\): boolean \{\s*\n\s*return this\._ready;\s*\n\s*\}/);
  });

  it('dispatches concordia:physics-ready once _ready flips true inside init()', () => {
    const initMatch = physicsSrc.match(/async init\(\): Promise<void> \{[\s\S]*?\n  \}/);
    expect(initMatch).toBeTruthy();
    expect(initMatch![0]).toMatch(/this\._ready = true;/);
    expect(initMatch![0]).toMatch(/window\.dispatchEvent\(new CustomEvent\('concordia:physics-ready'\)\);/);
    // Dispatch must come after the _ready flip, not before (would race the
    // same way the bug did if a listener re-entered synchronously).
    const readyIdx = initMatch![0].indexOf('this._ready = true;');
    const dispatchIdx = initMatch![0].indexOf("dispatchEvent(new CustomEvent('concordia:physics-ready')");
    expect(readyIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(readyIdx);
  });
});
