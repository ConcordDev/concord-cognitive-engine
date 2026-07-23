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
// exactly this reason.
//
// The teardown logic itself (composer/renderer/physics disposal, the
// dome+ragdoll-bridge cleanup pair, and the disposed-flag race guard the
// ragdoll bridge's async attach goes through) has since been extracted out
// of the mount effect's cleanup closure into three standalone exported
// functions — `disposeComposerAndRendererResources`,
// `disposeDomeAndRagdollBridge`, `commitRagdollBridgeDetach` — specifically
// so this file can drive the REAL production logic with fake ref-shaped
// objects carrying `vi.fn()` dispose/destroy spies, instead of only
// regex-matching source text. The remaining structural pins (listener
// stash/removal, ref type declarations) stay as source-text checks since
// they don't claim runtime behavior in their own titles.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  disposeComposerAndRendererResources,
  disposeDomeAndRagdollBridge,
  commitRagdollBridgeDetach,
} from '@/components/world-lens/ConcordiaScene';

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

describe('Finding #4 — EffectComposer no longer leaks (disposeComposerAndRendererResources)', () => {
  it('composerRef type declares an optional dispose method', () => {
    expect(src).toMatch(/const composerRef = useRef<\{\s*\n\s*render: \(delta: number\) => void;\s*\n\s*setSize: \(w: number, h: number\) => void;\s*\n\s*dispose\?: \(\) => void;\s*\n\s*\} \| null>\(null\);/);
  });

  it('invokes the stashed _dofCleanup hook before disposing the composer, and nulls the ref', () => {
    const dofCleanup = vi.fn();
    const dispose = vi.fn();
    const composerRef = { current: { _dofCleanup: dofCleanup, dispose } as unknown as { dispose?: () => void } & { _dofCleanup?: () => void } };
    const rendererRef = { current: null as { dispose: () => void } | null };
    const physicsRef = { current: null as { destroy: () => void } | null };

    disposeComposerAndRendererResources(composerRef, rendererRef, physicsRef);

    expect(dofCleanup).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dofCleanup.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(composerRef.current).toBeNull();
  });

  it('calls composerRef.current.dispose() and nulls the ref even when composer has no _dofCleanup hook', () => {
    const dispose = vi.fn();
    const composerRef = { current: { dispose } as { dispose?: () => void } & { _dofCleanup?: () => void } };
    const rendererRef = { current: null as { dispose: () => void } | null };
    const physicsRef = { current: null as { destroy: () => void } | null };

    disposeComposerAndRendererResources(composerRef, rendererRef, physicsRef);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(composerRef.current).toBeNull();
  });

  it('composer disposal happens in the SAME call as the renderer.dispose()/physics.destroy() calls — one function, all three teardowns', () => {
    const dofCleanup = vi.fn();
    const composerDispose = vi.fn();
    const rendererDispose = vi.fn();
    const physicsDestroy = vi.fn();
    const composerRef = { current: { _dofCleanup: dofCleanup, dispose: composerDispose } as { dispose?: () => void } & { _dofCleanup?: () => void } };
    const rendererRef = { current: { dispose: rendererDispose } };
    const physicsRef = { current: { destroy: physicsDestroy } };

    disposeComposerAndRendererResources(composerRef, rendererRef, physicsRef);

    // All four real calls happened from the one function call — proves the
    // composer teardown is not isolated from the rest of the scene teardown.
    expect(dofCleanup).toHaveBeenCalledTimes(1);
    expect(composerDispose).toHaveBeenCalledTimes(1);
    expect(rendererDispose).toHaveBeenCalledTimes(1);
    expect(physicsDestroy).toHaveBeenCalledTimes(1);
    expect(composerRef.current).toBeNull();
    expect(physicsRef.current).toBeNull();
  });

  it('swallows a throwing composer dispose (idempotent teardown) and still proceeds to renderer/physics', () => {
    const rendererDispose = vi.fn();
    const physicsDestroy = vi.fn();
    const composerRef = {
      current: {
        dispose: () => { throw new Error('already disposed'); },
      } as { dispose?: () => void } & { _dofCleanup?: () => void },
    };
    const rendererRef = { current: { dispose: rendererDispose } };
    const physicsRef = { current: { destroy: physicsDestroy } };

    expect(() => disposeComposerAndRendererResources(composerRef, rendererRef, physicsRef)).not.toThrow();
    expect(rendererDispose).toHaveBeenCalledTimes(1);
    expect(physicsDestroy).toHaveBeenCalledTimes(1);
  });

  it('handles a null renderer/physics ref without throwing (no renderer mounted yet)', () => {
    const composerRef = { current: null as ({ dispose?: () => void } & { _dofCleanup?: () => void }) | null };
    const rendererRef = { current: null as { dispose: () => void } | null };
    const physicsRef = { current: null as { destroy: () => void } | null };

    expect(() => disposeComposerAndRendererResources(composerRef, rendererRef, physicsRef)).not.toThrow();
  });
});

// Two purely-structural guards used to live here — "declares a
// ragdollBridgeCleanupRef mirroring the existing domeCleanupRef pattern"
// and "the old dead __detachRagdoll stash is gone" — both regex-only, no
// runtime indicator. DELETED as redundant: the real behavior they gestured
// at (ragdollBridgeCleanupRef actually following the same
// commit-then-dispose-and-null lifecycle domeCleanupRef does, replacing
// the old dead stash) is now fully exercised for real by the three tests
// immediately below (`commits detach() into the ref...`, `detaches
// immediately...`, `cleanup invokes and nulls ragdollBridgeCleanupRef...`),
// which call the actual exported `commitRagdollBridgeDetach` /
// `disposeDomeAndRagdollBridge` functions with spies rather than reading
// source text.
describe('Finding #6 (ConcordiaScene.tsx portion) — ragdoll-bridge detach wired into teardown', () => {
  it('commits detach() into the ref when the effect has not yet been disposed', () => {
    const detach = vi.fn();
    const ragdollBridgeCleanupRef = { current: null as (() => void) | null };

    commitRagdollBridgeDetach(detach, false, ragdollBridgeCleanupRef);

    expect(detach).not.toHaveBeenCalled();
    expect(ragdollBridgeCleanupRef.current).toBe(detach);
  });

  it('detaches immediately (guarding the disposed-flag race) instead of stashing a handle nothing will ever call', () => {
    const detach = vi.fn();
    const ragdollBridgeCleanupRef = { current: null as (() => void) | null };

    commitRagdollBridgeDetach(detach, true, ragdollBridgeCleanupRef);

    expect(detach).toHaveBeenCalledTimes(1);
    expect(ragdollBridgeCleanupRef.current).toBeNull();
  });

  it('cleanup invokes and nulls ragdollBridgeCleanupRef alongside domeCleanupRef, in one real call', () => {
    const domeDetach = vi.fn();
    const ragdollDetach = vi.fn();
    const domeCleanupRef = { current: domeDetach as (() => void) | null };
    const ragdollBridgeCleanupRef = { current: ragdollDetach as (() => void) | null };

    disposeDomeAndRagdollBridge(domeCleanupRef, ragdollBridgeCleanupRef);

    expect(domeDetach).toHaveBeenCalledTimes(1);
    expect(ragdollDetach).toHaveBeenCalledTimes(1);
    expect(domeCleanupRef.current).toBeNull();
    expect(ragdollBridgeCleanupRef.current).toBeNull();
  });

  it('swallows a throwing dome/ragdoll detach (idempotent) rather than letting one bad detach block the other', () => {
    const ragdollDetach = vi.fn();
    const domeCleanupRef = {
      current: (() => { throw new Error('dome detach failed'); }) as (() => void) | null,
    };
    const ragdollBridgeCleanupRef = { current: ragdollDetach as (() => void) | null };

    expect(() => disposeDomeAndRagdollBridge(domeCleanupRef, ragdollBridgeCleanupRef)).not.toThrow();
    expect(ragdollDetach).toHaveBeenCalledTimes(1);
    expect(domeCleanupRef.current).toBeNull();
    expect(ragdollBridgeCleanupRef.current).toBeNull();
  });
});
