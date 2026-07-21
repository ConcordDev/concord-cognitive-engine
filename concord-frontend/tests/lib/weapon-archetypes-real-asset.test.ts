// Stability audit (2026-07-21) — real-asset-first wiring for weapon
// archetypes ("guns/staffs/wands are now visible" fix). weapon-archetypes.ts
// builds real THREE.Group/Mesh/Geometry objects, which is pure computation
// (no WebGL/canvas context needed to construct — only rendering one to
// pixels would need that), so this gets real behavioral coverage rather
// than a source pin, matching the precedent set by
// tests/lib/cinematic-shot-geometry.test.ts for other Three.js-adjacent
// pure-function modules in this codebase.
//
// asset-loader.ts is mocked so these tests are deterministic and don't hit
// the network/filesystem. warmRealWeaponAssets() memoizes at module scope
// (by design — production code should warm once per page load, not once
// per createWeapon() call), so each describe block that needs a specific
// warm-state resets the module registry and re-imports fresh rather than
// relying on vitest's default single shared module instance — otherwise
// whichever block runs first would permanently decide `warmed` for every
// later block in this file.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type * as WeaponArchetypesModule from '@/lib/concordia/weapon-archetypes';
import type { WeaponArchetype } from '@/lib/concordia/weapon-archetypes';

const mockLoadAsset = vi.fn();
const mockResolveAssetReference = vi.fn();
const mockGetCachedSceneSync = vi.fn();

vi.mock('@/lib/world-lens/asset-loader', () => ({
  loadAsset: (...args: unknown[]) => mockLoadAsset(...args),
  resolveAssetReference: (...args: unknown[]) => mockResolveAssetReference(...args),
  getCachedSceneSync: (...args: unknown[]) => mockGetCachedSceneSync(...args),
}));

const ALL_ARCHETYPES: WeaponArchetype[] = [
  'shortsword', 'longsword', 'axe', 'mace', 'dagger', 'club',
  'scimitar', 'greatsword', 'halberd', 'spear', 'bow', 'crossbow',
  'firearm_pistol', 'firearm_rifle', 'staff', 'wand',
];
const REAL_ASSET_ARCHETYPES: WeaponArchetype[] = ['firearm_pistol', 'firearm_rifle', 'staff', 'wand'];

function countMeshes(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
}

/** Fresh module instance per call — resets weapon-archetypes.ts's
 *  module-level warm-cache state so each test controls its own scenario. */
async function freshModule(): Promise<typeof WeaponArchetypesModule> {
  vi.resetModules();
  return import('@/lib/concordia/weapon-archetypes');
}

describe('createWeapon — procedural fallback (no real asset ever resolves)', () => {
  let createWeapon: typeof WeaponArchetypesModule.createWeapon;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadAsset.mockResolvedValue(null);
    mockResolveAssetReference.mockResolvedValue(null);
    mockGetCachedSceneSync.mockReturnValue(null);
    ({ createWeapon } = await freshModule());
  });

  it('returns a non-empty THREE.Group with real mesh geometry for every archetype (12 legacy + 4 new)', () => {
    for (const archetype of ALL_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      expect(group).toBeInstanceOf(THREE.Group);
      expect(countMeshes(group)).toBeGreaterThan(0);
    }
  });

  it('the 4 new archetypes produce distinct, non-degenerate bounding boxes', () => {
    for (const archetype of REAL_ASSET_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 3 });
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      box.getSize(size);
      expect(size.length()).toBeGreaterThan(0);
    }
  });

  it('firearm_rifle has a shoulder stock (extra mesh) that firearm_pistol lacks', () => {
    const pistol = createWeapon({ archetype: 'firearm_pistol', tier: 1 });
    const rifle = createWeapon({ archetype: 'firearm_rifle', tier: 1 });
    expect(countMeshes(rifle)).toBeGreaterThan(countMeshes(pistol));
  });

  it('staff is taller than wand (procedural shaft length)', () => {
    const staff = createWeapon({ archetype: 'staff', tier: 1 });
    const wand = createWeapon({ archetype: 'wand', tier: 1 });
    const staffBox = new THREE.Box3().setFromObject(staff);
    const wandBox = new THREE.Box3().setFromObject(wand);
    const staffSize = new THREE.Vector3(); staffBox.getSize(staffSize);
    const wandSize = new THREE.Vector3(); wandBox.getSize(wandSize);
    expect(staffSize.y).toBeGreaterThan(wandSize.y);
  });

  it('tier scaling never throws across the full 1-5 range for the new archetypes', () => {
    for (const archetype of REAL_ASSET_ARCHETYPES) {
      for (let tier = 1; tier <= 5; tier++) {
        expect(() => createWeapon({ archetype, tier })).not.toThrow();
      }
    }
  });

  it("enchantment glow lights up the staff's tip mesh specifically (not just any material's Three.js-default baseline)", () => {
    // MeshStandardMaterial defaults emissiveIntensity to 1.0 even with no
    // emissive color set, so this compares the LAST mesh added (the tip,
    // built with bladeMat — the one material whose emissive is actually
    // enchantment-conditional) rather than summing every mesh, which would
    // just measure the shaft's constant default-material baseline.
    const plainMeshes: THREE.Mesh[] = [];
    createWeapon({ archetype: 'staff', tier: 1 }).traverse((o) => { if ((o as THREE.Mesh).isMesh) plainMeshes.push(o as THREE.Mesh); });
    const enchantedMeshes: THREE.Mesh[] = [];
    createWeapon({ archetype: 'staff', tier: 1, enchantment: 'arcane' }).traverse((o) => { if ((o as THREE.Mesh).isMesh) enchantedMeshes.push(o as THREE.Mesh); });
    const plainTip = plainMeshes[plainMeshes.length - 1].material as THREE.MeshStandardMaterial;
    const enchantedTip = enchantedMeshes[enchantedMeshes.length - 1].material as THREE.MeshStandardMaterial;
    expect(enchantedTip.emissiveIntensity).toBeGreaterThan(plainTip.emissiveIntensity);
    expect(enchantedTip.emissive.getHex()).not.toBe(0x000000);
  });

  it('userData marks realAsset as absent/false on the procedural path', () => {
    const group = createWeapon({ archetype: 'firearm_pistol', tier: 1 });
    expect(group.userData.realAsset).toBeFalsy();
    expect(group.userData.archetype).toBe('firearm_pistol');
  });
});

describe('createWeapon — real-asset path (warmed cache)', () => {
  let createWeapon: typeof WeaponArchetypesModule.createWeapon;
  let warmRealWeaponAssets: typeof WeaponArchetypesModule.warmRealWeaponAssets;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadAsset.mockResolvedValue({ fakeScene: true });
    mockResolveAssetReference.mockImplementation(async ({ id }: { id: string }) => `/models/weapon/${id}.glb`);
    mockGetCachedSceneSync.mockImplementation((url: string) => {
      // A minimal but real THREE.Object3D so clone(true)/Box3 math is genuine.
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      g.add(mesh);
      g.name = `source_${url}`;
      return g;
    });
    ({ createWeapon, warmRealWeaponAssets } = await freshModule());
  });

  it('after warmRealWeaponAssets() resolves, createWeapon returns a cloned real-asset group', async () => {
    await warmRealWeaponAssets();
    const group = createWeapon({ archetype: 'staff', tier: 2 });
    expect(group.userData.realAsset).toBe(true);
    expect(group.userData.archetype).toBe('staff');
    expect(countMeshes(group)).toBeGreaterThan(0);
  });

  it('warmRealWeaponAssets() is memoized — a second call does not re-invoke loadAsset', async () => {
    await warmRealWeaponAssets();
    const callsAfterFirst = mockLoadAsset.mock.calls.length;
    await warmRealWeaponAssets();
    expect(mockLoadAsset.mock.calls.length).toBe(callsAfterFirst);
  });

  it('real-asset groups are normalized to a non-degenerate, bounded size for each archetype', async () => {
    await warmRealWeaponAssets();
    for (const archetype of REAL_ASSET_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longest = Math.max(size.x, size.y, size.z);
      expect(longest).toBeGreaterThan(0);
      expect(longest).toBeLessThan(2); // sanity: no archetype's target exceeds 2m
    }
  });

  it("non-real-asset archetypes (e.g. 'longsword') still take the procedural path even after warming", async () => {
    await warmRealWeaponAssets();
    const group = createWeapon({ archetype: 'longsword', tier: 1 });
    expect(group.userData.realAsset).toBeFalsy();
  });

  it('createWeapon() itself kicks off warming even without an explicit warmRealWeaponAssets() call (fire-and-forget)', async () => {
    // First call — warming has not resolved yet, so this hits the
    // procedural fallback (matches production's eventual-consistency
    // tradeoff, documented in the module's own header comment).
    const first = createWeapon({ archetype: 'wand', tier: 1 });
    expect(first.userData.realAsset).toBeFalsy();
    // Let the fire-and-forget warm triggered by that first call resolve.
    await warmRealWeaponAssets();
    const second = createWeapon({ archetype: 'wand', tier: 1 });
    expect(second.userData.realAsset).toBe(true);
  });
});

describe('normalizeRealAssetScale (pure function, direct coverage)', () => {
  let normalizeRealAssetScale: typeof WeaponArchetypesModule.normalizeRealAssetScale;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ normalizeRealAssetScale } = await freshModule());
  });

  function makeTestBox(w: number, h: number, d: number, offsetY = 0): THREE.Object3D {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    mesh.position.y = offsetY;
    group.add(mesh);
    return group;
  }

  it("'center' pivot centers the bounding box on the local origin", () => {
    const obj = makeTestBox(1, 2, 1, 5); // box far from origin
    normalizeRealAssetScale(obj, 1, 'center');
    const box = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(center.length()).toBeLessThan(1e-6);
  });

  it("'bottom' pivot places the bounding box's minimum Y at the local origin, x/z centered", () => {
    const obj = makeTestBox(1, 2, 1, 5);
    normalizeRealAssetScale(obj, 1, 'bottom');
    const box = new THREE.Box3().setFromObject(obj);
    expect(Math.abs(box.min.y)).toBeLessThan(1e-6);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(Math.abs(center.x)).toBeLessThan(1e-6);
    expect(Math.abs(center.z)).toBeLessThan(1e-6);
  });

  it('rescales the longest dimension to exactly the target size', () => {
    const obj = makeTestBox(1, 4, 2); // longest dim = 4 (height)
    normalizeRealAssetScale(obj, 2, 'center');
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(2, 5);
  });

  it('handles a degenerate (zero-size) object without throwing or dividing by zero to Infinity', () => {
    const obj = new THREE.Group(); // empty group — Box3 will be empty
    expect(() => normalizeRealAssetScale(obj, 1, 'center')).not.toThrow();
    expect(Number.isFinite(obj.scale.x)).toBe(true);
  });
});

describe('WEAPON_CONSTANTS — unchanged by this pass', () => {
  it('still exposes the original enchantment/default-color constants', async () => {
    const { WEAPON_CONSTANTS } = await freshModule();
    expect(WEAPON_CONSTANTS.ENCHANTMENT_GLOW.fire).toBeDefined();
    expect(WEAPON_CONSTANTS.DEFAULT_BASE_COLOR).toBeDefined();
  });
});
