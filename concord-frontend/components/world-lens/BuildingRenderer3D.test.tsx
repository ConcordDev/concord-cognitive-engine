/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Regression test for the CanvasTexture/DataTexture leak fixed in
 * BuildingRenderer3D.tsx (docs/concordia-specs/runtime-health-capability-map.md
 * finding #1).
 *
 * The legacy (non-archetype) building path calls `createMaterial()` once per
 * floor of walls; each call wraps TextureForge's cached canvases in brand-new
 * `THREE.CanvasTexture` instances (map/roughnessMap/normalMap), or — in toon
 * render mode — a fresh `THREE.DataTexture` gradient map. `Material.dispose()`
 * does NOT cascade to these texture maps, so the pre-fix cleanup (which only
 * called `.dispose()` on the material) silently dropped every texture without
 * freeing its GPU-side resource.
 *
 * This test renders real buildings through the real `three` package (no
 * WebGL renderer is ever created — only Object3D/Material/Texture graph
 * construction, which works fine under jsdom), spies on
 * `THREE.Texture.prototype.dispose` (the shared, un-overridden dispose that
 * both CanvasTexture and DataTexture inherit), unmounts the component, and
 * asserts the exact number of texture disposals fired — proving the fix
 * actually reaches `.map` / `.normalMap` / `.roughnessMap` / `.gradientMap`,
 * not just `Material.dispose()`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import BuildingRenderer3D, { type BuildingDTU } from './BuildingRenderer3D';

// TextureForge draws to real <canvas> 2D contexts, which jsdom doesn't
// implement without the native `canvas` package. Stand in with plain
// objects — THREE.CanvasTexture only stores whatever it's given as
// `.image`, it never touches canvas APIs at construction time.
vi.mock('@/lib/world-lens/texture-forge', () => {
  const pair = () => ({ map: {}, roughnessMap: {}, normalMap: {} });
  return {
    TextureForge: {
      getBrick: vi.fn(() => pair()),
      getConcrete: vi.fn(() => pair()),
      getWood: vi.fn(() => pair()),
      getMetal: vi.fn(() => pair()),
      getGlass: vi.fn(() => pair()),
    },
  };
});

// Skip the EvoAsset texture-override path entirely so the wall material's
// procedural CanvasTexture (the one under test) isn't replaced.
vi.mock('@/lib/evo-asset/loader', () => ({
  resolveAssetUrl: vi.fn(async () => null),
  recordAssetInteraction: vi.fn(),
}));

function makeBuilding(overrides: Partial<BuildingDTU> = {}): BuildingDTU {
  return {
    id: 'b1',
    name: 'Test Hall',
    position: { x: 0, y: 0, z: 0 },
    dimensions: { width: 10, height: 12, depth: 10 },
    floors: 3,
    material: 'brick',
    style: 'colonial',
    // No `building_type` / `archetype` — stays on the legacy structural path
    // this bug lives in, not the procedural-buildings archetype path.
    structure: {
      columns: { count: 4, spacing: 2, radius: 0.3 },
      beams: { count: 3, height: 0.3 },
      roofType: 'flat',
      hasBasement: false,
      windowRows: 2,
      windowsPerRow: 3,
    },
    ...overrides,
  };
}

type BuiltGroup = { traverse: (cb: (obj: unknown) => void) => void };

/**
 * Resolves with the `buildingGroup` the component publishes on
 * `concordia:buildings-ready` — the real built Object3D graph, so a test can
 * inspect the actual materials that were handed to the GPU-side objects rather
 * than re-deriving what it thinks they should be.
 */
async function waitForBuildEvent(): Promise<BuiltGroup> {
  // @resource-leak-ok: { once: true } self-removes this listener the first
  // time the event fires — there is no matching removeEventListener call
  // because none is needed, not because cleanup was forgotten.
  return new Promise<BuiltGroup>((resolve) => {
    window.addEventListener(
      'concordia:buildings-ready',
      (e) => resolve((e as CustomEvent).detail.buildingGroup as BuiltGroup),
      { once: true },
    );
  });
}

type GradientBearingMaterial = { gradientMap?: { userData?: Record<string, unknown> } | null };

/** Every material in a built group that carries a `gradientMap` (i.e. is toon-shaded). */
function materialsWithGradientMap(group: BuiltGroup): GradientBearingMaterial[] {
  const out: GradientBearingMaterial[] = [];
  group.traverse((obj) => {
    const mesh = obj as { material?: GradientBearingMaterial | GradientBearingMaterial[] };
    if (!mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m && m.gradientMap) out.push(m);
    }
  });
  return out;
}

describe('BuildingRenderer3D texture disposal (legacy structural path)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disposes map/normalMap/roughnessMap for every floor on unmount (PBR mode)', async () => {
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');

    const building = makeBuilding({ floors: 3 });
    const { unmount } = render(
      <BuildingRenderer3D buildings={[building]} viewMode="normal" renderStyle="pbr" />
    );

    await waitForBuildEvent();

    // Nothing should be disposed yet — the building is still mounted.
    expect(disposeSpy).not.toHaveBeenCalled();

    unmount();

    // One wall CanvasTexture set (map + roughnessMap + normalMap) is created
    // per floor by getProceduralTextures(); 3 floors * 3 maps = 9 disposals.
    // (Foundation/columns/beams/roof/window/LOD materials carry no procedural
    // texture maps, so they never add to this count — only their
    // Material.dispose() fires, which this spy doesn't observe.)
    expect(disposeSpy).toHaveBeenCalledTimes(3 * 3);
  });

  // ── Toon mode: the gradient ramp is CACHE-OWNED, so NOT disposing it is the
  // correct behavior — and is the opposite of what this test asserted before
  // 2026-07-25.
  //
  // The original contract was "one 1x3 DataTexture gradientMap allocated per
  // floor, therefore N disposals on unmount." That was true when this file
  // built its own gradient inline (`createToonGradientMap()`, one fresh texture
  // per material). The art-direction wiring pass replaced that with the shared
  // `toonGradientTextureFromPalette()`, which caches ONE DataTexture per
  // (palette, band-count) and hands the same instance to every material asking
  // for that ramp — so the band count comes from the single locked
  // ART_STYLE.RAMP_BANDS constant instead of a hardcoded 3 in this file.
  //
  // That makes the old per-floor disposal actively WRONG: unmounting one
  // building would dispose a texture the cache still owns and still hands out,
  // so the next mount — of any building anywhere sharing that palette — would
  // receive a disposed handle and render untextured. Hence the
  // `__celShared` flag and the cleanup's skip.
  //
  // The two tests below pin that contract in BOTH directions, so this can't
  // silently regress into either a leak or a use-after-dispose.
  it('does NOT dispose the cache-owned toon gradientMap, and it survives remount', async () => {
    const building = makeBuilding({ floors: 2 });

    // Mount once so the shared ramp is definitely in the cache, then grab the
    // exact texture instance the materials were handed.
    const first = render(
      <BuildingRenderer3D buildings={[building]} viewMode="normal" renderStyle="toon" />
    );
    await waitForBuildEvent();

    const { toonGradientTextureFromPalette } = await import('@/lib/world-lens/cel-shade');
    const { CONCORDIA_THEMES, DEFAULT_THEME_ID, ART_STYLE } = await import(
      '@/lib/world-lens/concordia-theme'
    );
    const palette = CONCORDIA_THEMES[DEFAULT_THEME_ID].toonGradient;
    const shared = toonGradientTextureFromPalette(THREE, palette, ART_STYLE.RAMP_BANDS);

    // It really is the shared/cached instance, not a per-call allocation —
    // if this stopped holding, the disposal-skip below would be papering over
    // a genuine per-floor leak instead of protecting a cache.
    expect(toonGradientTextureFromPalette(THREE, palette, ART_STYLE.RAMP_BANDS)).toBe(shared);
    expect(shared.userData?.__celShared).toBe(true);

    // Spy only AFTER the mount, so this counts unmount-time disposals only.
    const sharedDisposeSpy = vi.spyOn(shared, 'dispose');
    first.unmount();

    // The whole point: cleanup must leave the cache's texture alive.
    expect(sharedDisposeSpy).not.toHaveBeenCalled();

    // And the cache must still hand back that same, still-usable instance on a
    // fresh mount — this is the actual use-after-dispose regression the skip
    // exists to prevent.
    const second = render(
      <BuildingRenderer3D buildings={[building]} viewMode="normal" renderStyle="toon" />
    );
    await waitForBuildEvent();
    expect(toonGradientTextureFromPalette(THREE, palette, ART_STYLE.RAMP_BANDS)).toBe(shared);
    expect(sharedDisposeSpy).not.toHaveBeenCalled();
    second.unmount();
  });

  it('still disposes a NON-shared gradientMap (the skip is targeted, not a gutted cleanup)', async () => {
    // Guards the other direction: it would be easy to "fix" the failing
    // assertion above by deleting the gradientMap disposal outright. This
    // proves the cleanup still frees any gradient texture that ISN'T
    // cache-owned — i.e. the skip keys on `__celShared`, not on the field name.
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');

    const building = makeBuilding({ floors: 2 });
    const { unmount } = render(
      <BuildingRenderer3D buildings={[building]} viewMode="normal" renderStyle="toon" />
    );
    const group = await waitForBuildEvent();

    // Retag every mounted toon material's gradient as NOT cache-owned, which is
    // exactly the shape a future per-instance ramp would have.
    const untagged = new Set<{ userData?: Record<string, unknown> }>();
    for (const mat of materialsWithGradientMap(group)) {
      const g = mat.gradientMap as { userData?: Record<string, unknown> } | null;
      if (g && !untagged.has(g)) {
        g.userData = { ...(g.userData || {}), __celShared: false };
        untagged.add(g);
      }
    }
    expect(untagged.size).toBeGreaterThan(0);

    disposeSpy.mockClear();
    unmount();

    // Every gradient we un-tagged must now be freed by the same cleanup path.
    expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(untagged.size);

    // Restore the cache's real flag so later tests in this file (and the shared
    // module-level cache) aren't left poisoned by this one.
    for (const g of untagged) g.userData = { ...(g.userData || {}), __celShared: true };
  });

  it('does not leak textures across a rebuild (props change re-triggers the effect)', async () => {
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');

    const building = makeBuilding({ floors: 2 });
    const { rerender, unmount } = render(
      <BuildingRenderer3D buildings={[building]} viewMode="normal" renderStyle="pbr" />
    );
    await waitForBuildEvent();
    expect(disposeSpy).not.toHaveBeenCalled();

    // Changing `buildings` by reference re-runs the build effect, whose
    // cleanup fires for the PREVIOUS build before constructing the new one.
    const rebuiltBuilding = makeBuilding({ floors: 2, name: 'Rebuilt Hall' });
    rerender(
      <BuildingRenderer3D buildings={[rebuiltBuilding]} viewMode="normal" renderStyle="pbr" />
    );
    await waitForBuildEvent();

    // The first build's 2 floors * 3 maps = 6 textures must have been freed
    // before/around the second build running.
    expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(2 * 3);

    unmount();
    // Final unmount frees the second build's textures too.
    expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(2 * (2 * 3));
  });
});
