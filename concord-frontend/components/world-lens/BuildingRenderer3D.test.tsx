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

async function waitForBuildEvent(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.addEventListener('concordia:buildings-ready', () => resolve(), { once: true });
  });
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

  it('disposes the toon gradientMap for every floor on unmount (toon mode)', async () => {
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');

    const building = makeBuilding({ floors: 2 });
    const { unmount } = render(
      <BuildingRenderer3D buildings={[building]} viewMode="normal" renderStyle="toon" />
    );

    await waitForBuildEvent();
    unmount();

    // Toon mode skips the procedural map/normalMap/roughnessMap path
    // entirely and instead allocates one 1x3 DataTexture gradientMap per
    // floor: 2 floors * 1 gradientMap = 2 disposals.
    expect(disposeSpy).toHaveBeenCalledTimes(2);
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
