// runtime-health-capability-map.md finding #4 ("5 window listeners +
// undisposed EffectComposer leak") and the ConcordiaScene.tsx portion of
// finding #6 ("ragdoll-bridge detach never wired into teardown").
//
// ConcordiaScene.tsx pulls in Three.js scene construction, Rapier physics,
// and dozens of world-lens libraries that aren't mountable in a jsdom test
// environment — the codebase's own existing tests for this file
// (tests/avatar-system-effect-stability.test.tsx, tests/combat-prediction-
// camera-punch.test.ts, tests/sprint-7-visual-polish.test.ts,
// tests/feel-consolidation.test.ts) all use static source-text pins for
// exactly this reason. This file follows the same established pattern.
//
// What each pin proves:
//  1. The 4 scene-lifecycle listeners (terrain/buildings/avatars/scene-
//     request-ready) are no longer marked @resource-leak-ok — the premise
//     of that suppression (effect only tears down on full unmount) was
//     false, since the setup effect's own dependency array lets it re-fire
//     without a page unmount.
//  2. Each of those 4 listeners is actually removed in the cleanup
//     function, by reference (hoisted via an outer-scope variable since the
//     handlers are declared inside the nested async init()).
//  3. The EffectComposer's stashed _dofCleanup hook is invoked in cleanup.
//  4. composerRef.current.dispose() is called in cleanup and the ref is
//     nulled — the composer's WebGL render targets no longer leak.
//  5. The ragdoll-bridge detach() function is stored into a ref (mirroring
//     the existing domeCleanupRef pattern) and invoked+nulled in cleanup,
//     with a disposed-race guard so a slow dynamic import resolving after
//     teardown doesn't still attach a live listener.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);

describe('Finding #4 — scene-lifecycle window listeners no longer leak', () => {
  it('no @resource-leak-ok suppression remains on the 4 scene-lifecycle listeners', () => {
    expect(src).not.toMatch(/@resource-leak-ok/);
  });

  it('each of the 4 listener registrations stashes its handler for later removal', () => {
    expect(src).toMatch(/onTerrainPhysicsListener = onTerrainPhysics;\s*\n\s*window\.addEventListener\('concordia:terrain-ready', onTerrainPhysics\);/);
    expect(src).toMatch(/onBuildingsReadyListener = onBuildingsReady;\s*\n\s*window\.addEventListener\('concordia:buildings-ready', onBuildingsReady\);/);
    expect(src).toMatch(/onAvatarsReadyListener = onAvatarsReady;\s*\n\s*window\.addEventListener\('concordia:avatars-ready', onAvatarsReady\);/);
    expect(src).toMatch(/onSceneRequestListener = onSceneRequest;\s*\n\s*window\.addEventListener\('concordia:scene-request-ready', onSceneRequest\);/);
  });

  it('the cleanup function actually removes all 4 listeners by reference', () => {
    expect(src).toMatch(/if \(onTerrainPhysicsListener\) window\.removeEventListener\('concordia:terrain-ready', onTerrainPhysicsListener\);/);
    expect(src).toMatch(/if \(onBuildingsReadyListener\) window\.removeEventListener\('concordia:buildings-ready', onBuildingsReadyListener\);/);
    expect(src).toMatch(/if \(onAvatarsReadyListener\) window\.removeEventListener\('concordia:avatars-ready', onAvatarsReadyListener\);/);
    expect(src).toMatch(/if \(onSceneRequestListener\) window\.removeEventListener\('concordia:scene-request-ready', onSceneRequestListener\);/);
  });

  it('the cleanup listener-removal block sits alongside the existing resize/camera-punch/freecam/hide-hud removals', () => {
    const cleanupBlock = src.match(
      /window\.removeEventListener\('resize', handleResize\);[\s\S]*?canvas\.removeEventListener\('click', handleCanvasClick\);/
    );
    expect(cleanupBlock).toBeTruthy();
    expect(cleanupBlock![0]).toMatch(/onTerrainPhysicsListener/);
    expect(cleanupBlock![0]).toMatch(/onBuildingsReadyListener/);
    expect(cleanupBlock![0]).toMatch(/onAvatarsReadyListener/);
    expect(cleanupBlock![0]).toMatch(/onSceneRequestListener/);
  });
});

describe('Finding #4 — EffectComposer no longer leaks (_dofCleanup + dispose)', () => {
  it('composerRef type declares an optional dispose method', () => {
    expect(src).toMatch(/const composerRef = useRef<\{\s*\n\s*render: \(delta: number\) => void;\s*\n\s*setSize: \(w: number, h: number\) => void;\s*\n\s*dispose\?: \(\) => void;\s*\n\s*\} \| null>\(null\);/);
  });

  it('cleanup invokes the stashed _dofCleanup hook before disposing the composer', () => {
    const dofIdx = src.indexOf('_dofCleanup?.();');
    const disposeIdx = src.indexOf('composerRef.current?.dispose?.();');
    expect(dofIdx).toBeGreaterThan(-1);
    expect(disposeIdx).toBeGreaterThan(-1);
    expect(dofIdx).toBeLessThan(disposeIdx);
  });

  it('cleanup calls composerRef.current.dispose() and nulls the ref', () => {
    expect(src).toMatch(/composerRef\.current\?\.dispose\?\.\(\);\s*\n\s*\} catch \{ \/\* idempotent \*\/ \}\s*\n\s*composerRef\.current = null;/);
  });

  it('composer disposal sits in the same cleanup block as the renderer.dispose()/physics.destroy() calls', () => {
    const region = src.match(
      /composerRef\.current = null;\s*\n\s*\n\s*if \(rendererRef\.current\) \{\s*\n\s*\(rendererRef\.current as \{ dispose: \(\) => void \}\)\.dispose\(\);\s*\n\s*\}\s*\n\s*physicsRef\.current\?\.destroy\(\);/
    );
    expect(region).toBeTruthy();
  });
});

describe('Finding #6 (ConcordiaScene.tsx portion) — ragdoll-bridge detach wired into teardown', () => {
  it('declares a ragdollBridgeCleanupRef mirroring the existing domeCleanupRef pattern', () => {
    expect(src).toMatch(/const domeCleanupRef = useRef<\(\(\) => void\) \| null>\(null\);/);
    expect(src).toMatch(/const ragdollBridgeCleanupRef = useRef<\(\(\) => void\) \| null>\(null\);/);
  });

  it('the old dead __detachRagdoll stash (never read anywhere) is gone', () => {
    expect(src).not.toMatch(/__detachRagdoll/);
  });

  it('stores the ragdoll bridge detach() into the ref, guarded by the disposed flag race', () => {
    const attachBlock = src.match(
      /const detach = attachRagdollBridge\([\s\S]*?\);\s*\n[\s\S]*?if \(disposed\) \{\s*\n\s*detach\(\);\s*\n\s*\} else \{\s*\n\s*ragdollBridgeCleanupRef\.current = detach;\s*\n\s*\}/
    );
    expect(attachBlock).toBeTruthy();
  });

  it('cleanup invokes and nulls ragdollBridgeCleanupRef alongside domeCleanupRef', () => {
    expect(src).toMatch(
      /try \{ domeCleanupRef\.current\?\.\(\); \} catch \{ \/\* ignore \*\/ \}\s*\n\s*domeCleanupRef\.current = null;\s*\n\s*try \{ ragdollBridgeCleanupRef\.current\?\.\(\); \} catch \{ \/\* ignore \*\/ \}\s*\n\s*ragdollBridgeCleanupRef\.current = null;/
    );
  });
});
