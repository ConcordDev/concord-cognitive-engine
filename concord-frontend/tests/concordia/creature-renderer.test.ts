import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// Evo-asset material_upgrade wiring (2026-07-23 follow-up to
// BuildingRenderer3D.tsx's original pattern — see lib/evo-asset/loader.ts's
// "Named follow-ups" comment). createCreatureRenderer's real-asset path
// (real quadruped/winged_biped GLBs, see REAL_ASSET_TOPOLOGIES) now resolves
// a promoted material_upgrade per variant id and applies its PBR params onto
// the cloned GLB's materials, honest-null (no-op) when none is promoted.
//
// Test-setup note: warmRealCreatureAssets() is fire-and-forget (kicked from
// the constructor, same tick as the auto-triggered initial refresh()), and
// creature entries are built ONCE per id — a later poll for the SAME id
// never upgrades an already-built procedural mesh to the real-asset path
// (see the module's own "eventual consistency" comment). So the first
// refresh() (with an empty creature list) is used purely to let warming
// happen in the background; `waitForWarming` polls until
// resolveAssetReference has been called once per REAL_ASSET_TOPOLOGIES id
// (4: quadruped_01/02/03 + winged_biped_01), which only happens after the
// warm loop's per-id awaits have all settled. Only THEN is the real test
// creature introduced via a second refresh() with a fresh id, guaranteeing
// it takes the real-asset path deterministically instead of racing it.

vi.mock('@/lib/world-lens/asset-loader', () => ({
  loadAsset: vi.fn(),
  instanceFromCache: vi.fn(),
  resolveAssetReference: vi.fn(),
}));
vi.mock('@/lib/evo-asset/loader', () => ({
  resolveMaterialUpgrade: vi.fn(),
}));

import { loadAsset, instanceFromCache, resolveAssetReference } from '@/lib/world-lens/asset-loader';
import { resolveMaterialUpgrade } from '@/lib/evo-asset/loader';
import { createCreatureRenderer } from '@/lib/world-lens/creature-renderer';

type Mock = ReturnType<typeof vi.fn>;

function makeGlbGroup(): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  g.add(mesh);
  return g;
}

function stubFetch(creatures: Array<Record<string, unknown>>): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, result: { creatures } }),
  }));
}

/** Poll until warmRealCreatureAssets()'s per-id resolveAssetReference calls
 *  have all landed (one per REAL_ASSET_TOPOLOGIES id), then flush a couple
 *  more macrotasks so the `.then((urls) => { realAssetUrls = urls })`
 *  assignment that follows the warm loop has definitely run. */
async function waitForWarming(mock: Mock, expectedCalls = 4, maxIters = 50): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    if (mock.mock.calls.length >= expectedCalls) {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      return;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('creature-renderer — evo-asset material_upgrade on real-asset creatures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies a promoted material_upgrade's PBR params onto a real quadruped GLB", async () => {
    (loadAsset as Mock).mockResolvedValue(true);
    (resolveAssetReference as Mock).mockImplementation(async ({ id }: { id: string }) => `/models/creature/${id}.glb`);
    (instanceFromCache as Mock).mockImplementation(async () => makeGlbGroup());
    (resolveMaterialUpgrade as Mock).mockResolvedValue({ roughness: 0.2, metalness: 0.8 });
    stubFetch([]); // nothing for the auto-kicked initial poll to build

    const parent = new THREE.Group();
    const renderer = createCreatureRenderer(parent, { worldId: 'w1', pollMs: 999999 });

    await waitForWarming(resolveAssetReference as Mock, 4);

    stubFetch([{ id: 'c1', species_id: 'wolf', x: 1, y: 0, z: 2, topology: 'quadruped', clade: 'mammal' }]);
    await renderer.refresh();

    const creaturesGroup = parent.children.find((c) => c.name === 'creatures') as THREE.Group;
    expect(creaturesGroup).toBeTruthy();
    expect(creaturesGroup.children.length).toBe(1);

    const meshGroup = creaturesGroup.children[0];
    expect((meshGroup.userData as { evoMaterialUpgrade?: boolean }).evoMaterialUpgrade).toBe(true);

    let foundMesh: THREE.Mesh | null = null;
    meshGroup.traverse((o) => { if ((o as THREE.Mesh).isMesh) foundMesh = o as THREE.Mesh; });
    expect(foundMesh).toBeTruthy();
    const mat = foundMesh!.material as THREE.MeshStandardMaterial;
    expect(mat.roughness).toBeCloseTo(0.2, 5);
    expect(mat.metalness).toBeCloseTo(0.8, 5);

    renderer.dispose();
  });

  it('is a clean no-op (real asset still renders, material left as shipped) when no promoted upgrade exists', async () => {
    (loadAsset as Mock).mockResolvedValue(true);
    (resolveAssetReference as Mock).mockImplementation(async ({ id }: { id: string }) => `/models/creature/${id}.glb`);
    (instanceFromCache as Mock).mockImplementation(async () => makeGlbGroup());
    (resolveMaterialUpgrade as Mock).mockResolvedValue(null);
    stubFetch([]);

    const parent = new THREE.Group();
    const renderer = createCreatureRenderer(parent, { worldId: 'w1', pollMs: 999999 });

    await waitForWarming(resolveAssetReference as Mock, 4);

    stubFetch([{ id: 'c2', species_id: 'wolf', x: 0, y: 0, z: 0, topology: 'quadruped', clade: 'mammal' }]);
    await renderer.refresh();

    const creaturesGroup = parent.children.find((c) => c.name === 'creatures') as THREE.Group;
    expect(creaturesGroup.children.length).toBe(1);
    const meshGroup = creaturesGroup.children[0];
    expect((meshGroup.userData as { evoMaterialUpgrade?: boolean }).evoMaterialUpgrade).toBeUndefined();

    let foundMesh: THREE.Mesh | null = null;
    meshGroup.traverse((o) => { if ((o as THREE.Mesh).isMesh) foundMesh = o as THREE.Mesh; });
    expect(foundMesh).toBeTruthy();
    const mat = foundMesh!.material as THREE.MeshStandardMaterial;
    // THREE.MeshStandardMaterial's own untouched defaults.
    expect(mat.roughness).toBe(1);
    expect(mat.metalness).toBe(0);

    renderer.dispose();
  });

  it('does not throw when resolveMaterialUpgrade rejects (network failure) — real asset still renders', async () => {
    (loadAsset as Mock).mockResolvedValue(true);
    (resolveAssetReference as Mock).mockImplementation(async ({ id }: { id: string }) => `/models/creature/${id}.glb`);
    (instanceFromCache as Mock).mockImplementation(async () => makeGlbGroup());
    (resolveMaterialUpgrade as Mock).mockRejectedValue(new Error('network down'));
    stubFetch([]);

    const parent = new THREE.Group();
    const renderer = createCreatureRenderer(parent, { worldId: 'w1', pollMs: 999999 });

    await waitForWarming(resolveAssetReference as Mock, 4);

    stubFetch([{ id: 'c3', species_id: 'wolf', x: 0, y: 0, z: 0, topology: 'quadruped', clade: 'mammal' }]);
    await expect(renderer.refresh()).resolves.not.toThrow();

    const creaturesGroup = parent.children.find((c) => c.name === 'creatures') as THREE.Group;
    expect(creaturesGroup.children.length).toBe(1);

    renderer.dispose();
  });
});
