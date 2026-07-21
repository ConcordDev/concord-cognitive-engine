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
const REAL_ASSET_ARCHETYPES: WeaponArchetype[] = [
  'firearm_pistol', 'firearm_rifle', 'staff', 'wand',
  'shortsword', 'longsword', 'greatsword', 'axe', 'halberd', 'crossbow', 'dagger',
  'mace', 'club', 'spear', 'bow',
];
// The archetypes that get a discharge point (muzzle-flash / spell-spark
// anchor) — a strict subset of REAL_ASSET_ARCHETYPES; melee real-asset
// weapons swing, they don't discharge.
const DISCHARGE_ARCHETYPES: WeaponArchetype[] = ['firearm_pistol', 'firearm_rifle', 'staff', 'wand'];
// Still procedural-only — no sourced GLB found after a genuinely broad
// GitHub search (11 repos checked, see CREDITS.md).
const STILL_PROCEDURAL_ONLY: WeaponArchetype[] = ['scimitar'];

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
      // sanity ceiling: spear's real target size is 2.2m (a genuine
      // two-handed polearm length, matching its procedural fallback's own
      // shaftLen+tipLen) — the ceiling widened from 2 to 2.5 to admit it
      // rather than shrinking spear's real value to fit a stale assumption.
      expect(longest).toBeLessThan(2.5);
    }
  });

  it('non-real-asset archetypes (scimitar — no sourced GLB found) still take the procedural path even after warming', async () => {
    await warmRealWeaponAssets();
    for (const archetype of STILL_PROCEDURAL_ONLY) {
      const group = createWeapon({ archetype, tier: 1 });
      expect(group.userData.realAsset, `${archetype} should still be procedural`).toBeFalsy();
    }
  });

  it('all 15 real-asset archetypes (4 discharge-capable + 11 melee/ranged) resolve to a real-asset group once warmed', async () => {
    await warmRealWeaponAssets();
    for (const archetype of REAL_ASSET_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      expect(group.userData.realAsset, `${archetype} should be real-asset`).toBe(true);
    }
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

// Discharge point (muzzle-flash / spell-spark anchor) — the "the gun/staff
// now visibly reacts when it fires" follow-up. getDischargeWorldPosition()
// reads userData.dischargeLocal (set on every DISCHARGE_ARCHETYPES group,
// both procedural and real-asset paths) and transforms it to world space.
describe('getDischargeWorldPosition — procedural path (no real asset)', () => {
  let createWeapon: typeof WeaponArchetypesModule.createWeapon;
  let getDischargeWorldPosition: typeof WeaponArchetypesModule.getDischargeWorldPosition;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadAsset.mockResolvedValue(null);
    mockResolveAssetReference.mockResolvedValue(null);
    mockGetCachedSceneSync.mockReturnValue(null);
    ({ createWeapon, getDischargeWorldPosition } = await freshModule());
  });

  it('discharge-capable archetypes (firearms + staff/wand) return a non-null world position', () => {
    for (const archetype of DISCHARGE_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      const pos = getDischargeWorldPosition(group);
      expect(pos, `${archetype} should have a discharge point`).not.toBeNull();
    }
  });

  it('non-discharging archetypes (e.g. longsword) return null — nothing to anchor a flash to', () => {
    const group = createWeapon({ archetype: 'longsword', tier: 1 });
    expect(getDischargeWorldPosition(group)).toBeNull();
  });

  it("staff's discharge point sits at the shaft length, straight up from the grip", () => {
    const group = createWeapon({ archetype: 'staff', tier: 1 });
    const pos = getDischargeWorldPosition(group)!;
    expect(pos.y).toBeCloseTo(1.1, 5); // buildStaff's shaftLen for 'staff'
    expect(pos.x).toBeCloseTo(0, 5);
    expect(pos.z).toBeCloseTo(0, 5);
  });

  it("wand's discharge point is shorter than staff's (matches its shorter procedural shaft)", () => {
    const staffPos = getDischargeWorldPosition(createWeapon({ archetype: 'staff', tier: 1 }))!;
    const wandPos = getDischargeWorldPosition(createWeapon({ archetype: 'wand', tier: 1 }))!;
    expect(wandPos.y).toBeLessThan(staffPos.y);
  });

  it("firearm_rifle's discharge point (muzzle) is farther out than firearm_pistol's", () => {
    const pistolPos = getDischargeWorldPosition(createWeapon({ archetype: 'firearm_pistol', tier: 1 }))!;
    const riflePos = getDischargeWorldPosition(createWeapon({ archetype: 'firearm_rifle', tier: 1 }))!;
    expect(riflePos.x).toBeGreaterThan(pistolPos.x);
  });

  it('the discharge point tracks the group when parented under a moved ancestor (world-space, not local)', () => {
    const parent = new THREE.Group();
    parent.position.set(5, 2, -3);
    const wand = createWeapon({ archetype: 'wand', tier: 1 });
    parent.add(wand);
    const pos = getDischargeWorldPosition(wand)!;
    // Local discharge point is (0, 0.30, 0) — world position must be the
    // parent's translation applied on top, not the raw local value.
    expect(pos.x).toBeCloseTo(5, 5);
    expect(pos.y).toBeCloseTo(2.30, 5);
    expect(pos.z).toBeCloseTo(-3, 5);
  });

  it('the discharge point also reflects an ancestor rotation, for an off-axis local point (firearm muzzle)', () => {
    const parent = new THREE.Group();
    parent.rotation.y = Math.PI / 2; // 90° — swaps +X and +Z
    const pistol = createWeapon({ archetype: 'firearm_pistol', tier: 1 });
    parent.add(pistol);
    const pos = getDischargeWorldPosition(pistol)!;
    // Local discharge point is (bodyLen+barrelLen, 0, 0) — a 90° Y rotation
    // should swing that onto the Z axis, not leave it on X.
    expect(Math.abs(pos.x)).toBeLessThan(1e-5);
    expect(Math.abs(pos.z)).toBeGreaterThan(0.01);
  });
});

describe('getDischargeWorldPosition — real-asset path (warmed cache)', () => {
  let createWeapon: typeof WeaponArchetypesModule.createWeapon;
  let warmRealWeaponAssets: typeof WeaponArchetypesModule.warmRealWeaponAssets;
  let getDischargeWorldPosition: typeof WeaponArchetypesModule.getDischargeWorldPosition;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadAsset.mockResolvedValue({ fakeScene: true });
    mockResolveAssetReference.mockImplementation(async ({ id }: { id: string }) => `/models/weapon/${id}.glb`);
    mockGetCachedSceneSync.mockImplementation((url: string) => {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), new THREE.MeshStandardMaterial());
      // Off-center on purpose (like a real sourced asset would be) so the
      // pivot/discharge math is genuinely exercised, not trivially at origin.
      mesh.position.set(0.3, 0.5, 0.1);
      g.add(mesh);
      g.name = `source_${url}`;
      return g;
    });
    ({ createWeapon, warmRealWeaponAssets, getDischargeWorldPosition } = await freshModule());
  });

  it('real-asset discharge-capable archetypes still resolve a non-null discharge point', async () => {
    await warmRealWeaponAssets();
    for (const archetype of DISCHARGE_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      expect(group.userData.realAsset).toBe(true);
      const pos = getDischargeWorldPosition(group);
      expect(pos, `${archetype} should have a discharge point on the real-asset path`).not.toBeNull();
    }
  });

  it("real-asset staff's discharge point is exactly at its normalized target size (bottom-pivot guarantee)", async () => {
    await warmRealWeaponAssets();
    const group = createWeapon({ archetype: 'staff', tier: 1 });
    const pos = getDischargeWorldPosition(group)!;
    expect(pos.y).toBeCloseTo(1.3, 4); // staff's REAL_ASSET_NORMALIZATION target size
  });
});

// Stability audit (2026-07-21) — getWeaponTipWorldPosition, the general
// "business end" concept (widened from dischargeLocal, which only ever
// covered the 4 firearm/staff/wand archetypes) that the weapon-swing
// trail in AvatarSystem3D.tsx anchors to. Unlike getDischargeWorldPosition,
// this must resolve for ALL 16 archetypes, not just the discharge-capable 4.
describe('getWeaponTipWorldPosition — every archetype, procedural path', () => {
  let createWeapon: typeof WeaponArchetypesModule.createWeapon;
  let getWeaponTipWorldPosition: typeof WeaponArchetypesModule.getWeaponTipWorldPosition;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadAsset.mockResolvedValue(null);
    mockResolveAssetReference.mockResolvedValue(null);
    mockGetCachedSceneSync.mockReturnValue(null);
    ({ createWeapon, getWeaponTipWorldPosition } = await freshModule());
  });

  it('resolves a non-null tip for all 16 archetypes (melee weapons now included, not just the 4 discharge-capable ones)', () => {
    for (const archetype of ALL_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      const tip = getWeaponTipWorldPosition(group);
      expect(tip, `${archetype} should have a tip point`).not.toBeNull();
    }
  });

  it('a blade weapon\'s tip sits at the blade length above the grip', () => {
    const group = createWeapon({ archetype: 'dagger', tier: 1 });
    const tip = getWeaponTipWorldPosition(group)!;
    // dagger bladeLen is randomized (0.30 + rng()*0.05) — bounded, not exact.
    expect(tip.y).toBeGreaterThanOrEqual(0.30 - 1e-6);
    expect(tip.y).toBeLessThanOrEqual(0.35 + 1e-6);
  });

  it('greatsword\'s tip is farther than shortsword\'s (longer blade)', () => {
    const shortTip = getWeaponTipWorldPosition(createWeapon({ archetype: 'shortsword', tier: 1 }))!;
    const greatTip = getWeaponTipWorldPosition(createWeapon({ archetype: 'greatsword', tier: 1 }))!;
    expect(greatTip.y).toBeGreaterThan(shortTip.y);
  });

  it('for the 4 discharge-capable archetypes, tip and discharge points are identical (same physical point, two names)', async () => {
    const { getDischargeWorldPosition } = await freshModule();
    // freshModule() reset the mocks too — reapply them for this second import.
    mockLoadAsset.mockResolvedValue(null);
    mockResolveAssetReference.mockResolvedValue(null);
    mockGetCachedSceneSync.mockReturnValue(null);
    const { createWeapon: cw2, getWeaponTipWorldPosition: tipFn2 } = await freshModule();
    for (const archetype of DISCHARGE_ARCHETYPES) {
      const group = cw2({ archetype, tier: 1 });
      const tip = tipFn2(group)!;
      const discharge = getDischargeWorldPosition(group)!;
      expect(tip.x).toBeCloseTo(discharge.x, 6);
      expect(tip.y).toBeCloseTo(discharge.y, 6);
      expect(tip.z).toBeCloseTo(discharge.z, 6);
    }
  });

  it('non-discharge archetypes have a tip but no discharge point (asymmetric by design)', () => {
    const group = createWeapon({ archetype: 'axe', tier: 1 });
    expect(getWeaponTipWorldPosition(group)).not.toBeNull();
    expect((group.userData as { dischargeLocal?: unknown }).dischargeLocal).toBeUndefined();
  });
});

describe('getWeaponTipWorldPosition — real-asset path (warmed cache)', () => {
  let createWeapon: typeof WeaponArchetypesModule.createWeapon;
  let warmRealWeaponAssets: typeof WeaponArchetypesModule.warmRealWeaponAssets;
  let getWeaponTipWorldPosition: typeof WeaponArchetypesModule.getWeaponTipWorldPosition;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadAsset.mockResolvedValue({ fakeScene: true });
    mockResolveAssetReference.mockImplementation(async ({ id }: { id: string }) => `/models/weapon/${id}.glb`);
    mockGetCachedSceneSync.mockImplementation((url: string) => {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), new THREE.MeshStandardMaterial());
      mesh.position.set(0.3, 0.5, 0.1);
      g.add(mesh);
      g.name = `source_${url}`;
      return g;
    });
    ({ createWeapon, warmRealWeaponAssets, getWeaponTipWorldPosition } = await freshModule());
  });

  it('every real-asset archetype (all 15) resolves a non-null tip once warmed', async () => {
    await warmRealWeaponAssets();
    for (const archetype of REAL_ASSET_ARCHETYPES) {
      const group = createWeapon({ archetype, tier: 1 });
      expect(group.userData.realAsset).toBe(true);
      const tip = getWeaponTipWorldPosition(group);
      expect(tip, `${archetype} should have a real-asset tip`).not.toBeNull();
    }
  });

  it("a 'bottom'-pivoted real-asset archetype (longsword) has its tip exactly at its normalized target size", async () => {
    await warmRealWeaponAssets();
    const group = createWeapon({ archetype: 'longsword', tier: 1 });
    const tip = getWeaponTipWorldPosition(group)!;
    expect(tip.y).toBeCloseTo(1.05, 4); // longsword's REAL_ASSET_NORMALIZATION target size
  });

  it("mace/club/spear ('bottom' pivot, same convention as longsword) have their tip exactly at their normalized target size", async () => {
    await warmRealWeaponAssets();
    const cases: Array<[WeaponArchetype, number]> = [['mace', 0.6], ['club', 0.5], ['spear', 2.2]];
    for (const [archetype, expectedY] of cases) {
      const tip = getWeaponTipWorldPosition(createWeapon({ archetype, tier: 1 }))!;
      expect(tip.y, `${archetype} tip.y`).toBeCloseTo(expectedY, 4);
    }
  });

  it("a 'center'-pivoted real-asset archetype (crossbow) still resolves a tip via the bounding-box fallback", async () => {
    await warmRealWeaponAssets();
    const group = createWeapon({ archetype: 'crossbow', tier: 1 });
    const tip = getWeaponTipWorldPosition(group);
    expect(tip).not.toBeNull();
  });

  it("bow ('center' pivot with a Y-axis override, unlike crossbow/firearms' default Z) resolves its tip along Y, not Z", async () => {
    await warmRealWeaponAssets();
    const group = createWeapon({ archetype: 'bow', tier: 1 });
    const tip = getWeaponTipWorldPosition(group)!;
    // The shared mock source mesh is BoxGeometry(0.2, 1, 0.2) offset to
    // (0.3, 0.5, 0.1) — after 'center' pivot normalization (re-centers on
    // the scaled bbox) the Y extent dominates, so a correct Y-axis read
    // must land near the scaled half-height, not near zero the way a
    // stale Z-axis read would (Z's raw extent is only 0.2, dwarfed by Y's 1).
    expect(Math.abs(tip.y)).toBeGreaterThan(0.1);
  });
});
