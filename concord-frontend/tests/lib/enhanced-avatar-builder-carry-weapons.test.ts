// Stability audit (2026-07-21) — "guns/staffs/wands are now visible" fix,
// avatar-builder half. character-schema.ts's Accessories['carry'] union
// already declared 'pistol'/'rifle' as valid values (used as carryDefault
// by 5 real body-archetype presets — cyber-street, cyber-corp,
// cyber-blackout, crime-trench, crime-cartel) but enhanced-avatar-builder.ts
// never handled them: those NPCs' equipped firearms silently rendered
// nothing. This test builds a real avatar via buildEnhancedAvatar() (not a
// mock) and asserts a real weapon mesh (named 'weapon_firearm_pistol' /
// 'weapon_firearm_rifle' / 'weapon_wand' / 'weapon_staff', per
// weapon-archetypes.ts's createWeapon()) is actually present in the
// returned group for each carry value.
//
// asset-loader.ts is mocked to always miss (never resolves a real GLB) so
// this test exercises weapon-archetypes.ts's procedural fallback path
// deterministically, without a real network/filesystem GLB fetch — the
// real-asset path itself is covered separately in
// tests/lib/weapon-archetypes-real-asset.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { generateAppearance, type Accessories } from '@/lib/world-lens/character-schema';
import { buildEnhancedAvatar } from '@/lib/world-lens/enhanced-avatar-builder';

vi.mock('@/lib/world-lens/asset-loader', () => ({
  loadAsset: vi.fn().mockResolvedValue(null),
  resolveAssetReference: vi.fn().mockResolvedValue(null),
  getCachedSceneSync: vi.fn().mockReturnValue(null),
}));

function appearanceWithCarry(carry: NonNullable<Accessories['carry']>) {
  return generateAppearance({
    id: 'test-npc',
    worldId: 'test-world',
    themeId: 'classic',
    override: {
      accessories: { jewelry: [], markings: [], carry, augments: [] },
    },
  });
}

function findMeshByName(group: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => { if (o.name === name) found = o; });
  return found;
}

describe('buildEnhancedAvatar — carry items render a real weapon mesh', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("carry: ['pistol'] renders a weapon_firearm_pistol group, holstered at the hip", () => {
    const rich = appearanceWithCarry(['pistol']);
    const { group } = buildEnhancedAvatar(rich);
    const pistol = findMeshByName(group, 'weapon_firearm_pistol');
    expect(pistol).toBeDefined();
    expect(pistol!.parent).toBe(group);
  });

  it("carry: ['rifle'] renders a weapon_firearm_rifle group, slung on the back", () => {
    const rich = appearanceWithCarry(['rifle']);
    const { group } = buildEnhancedAvatar(rich);
    const rifle = findMeshByName(group, 'weapon_firearm_rifle');
    expect(rifle).toBeDefined();
    expect(rifle!.parent).toBe(group);
  });

  it("carry: ['staff'] renders a weapon_staff group (no longer the old bespoke bare cylinder)", () => {
    const rich = appearanceWithCarry(['staff']);
    const { group } = buildEnhancedAvatar(rich);
    const staff = findMeshByName(group, 'weapon_staff');
    expect(staff).toBeDefined();
  });

  it("carry: ['wand'] renders a weapon_wand group", () => {
    const rich = appearanceWithCarry(['wand']);
    const { group } = buildEnhancedAvatar(rich);
    const wand = findMeshByName(group, 'weapon_wand');
    expect(wand).toBeDefined();
  });

  it("carry: ['bow'] still renders a weapon_bow group (pre-existing path, unaffected)", () => {
    const rich = appearanceWithCarry(['bow']);
    const { group } = buildEnhancedAvatar(rich);
    const bow = findMeshByName(group, 'weapon_bow');
    expect(bow).toBeDefined();
  });

  it('multiple simultaneous carry items each render their own weapon mesh (rifle + wand)', () => {
    const rich = appearanceWithCarry(['rifle', 'wand']);
    const { group } = buildEnhancedAvatar(rich);
    expect(findMeshByName(group, 'weapon_firearm_rifle')).toBeDefined();
    expect(findMeshByName(group, 'weapon_wand')).toBeDefined();
  });

  it('no carry items — no weapon meshes at all (no false-positive rendering)', () => {
    const rich = appearanceWithCarry([]);
    const { group } = buildEnhancedAvatar(rich);
    let weaponCount = 0;
    group.traverse((o) => { if (o.userData?.isWeapon) weaponCount++; });
    expect(weaponCount).toBe(0);
  });

  it('pistol and rifle are positioned at different heights (holster vs. sling), not stacked identically', () => {
    const pistolRich = appearanceWithCarry(['pistol']);
    const rifleRich = appearanceWithCarry(['rifle']);
    const pistolGroup = findMeshByName(buildEnhancedAvatar(pistolRich).group, 'weapon_firearm_pistol')!;
    const rifleGroup = findMeshByName(buildEnhancedAvatar(rifleRich).group, 'weapon_firearm_rifle')!;
    expect(pistolGroup.position.y).not.toBeCloseTo(rifleGroup.position.y, 2);
  });
});

// Non-weapon carry gear — satchel/tome/tool-belt/pouch had NO branch at
// all in enhanced-avatar-builder.ts (unlike every weapon carry value
// above), despite being real carryDefault kit on several archetype
// presets (scholar/scavenger/mechanic/etc — see character-schema.ts).
// These are simple procedural props, not routed through
// weapon-archetypes.ts (they aren't combat weapons).
describe('buildEnhancedAvatar — non-weapon carry gear renders real props', () => {
  it("carry: ['satchel'] renders a carry_satchel mesh at the hip", () => {
    const rich = appearanceWithCarry(['satchel']);
    const { group } = buildEnhancedAvatar(rich);
    const satchel = findMeshByName(group, 'carry_satchel');
    expect(satchel).toBeDefined();
    expect(satchel!.parent).toBe(group);
  });

  it("carry: ['pouch'] renders a carry_pouch mesh, smaller and front-center vs. the satchel", () => {
    const satchelRich = appearanceWithCarry(['satchel']);
    const pouchRich = appearanceWithCarry(['pouch']);
    const satchel = findMeshByName(buildEnhancedAvatar(satchelRich).group, 'carry_satchel') as THREE.Mesh;
    const pouch = findMeshByName(buildEnhancedAvatar(pouchRich).group, 'carry_pouch') as THREE.Mesh;
    expect(pouch).toBeDefined();
    const satchelGeom = satchel.geometry as THREE.BoxGeometry;
    const pouchGeom = pouch.geometry as THREE.BoxGeometry;
    expect(pouchGeom.parameters.width).toBeLessThan(satchelGeom.parameters.width);
    // Different z placement (front-center vs. hip) — not stacked identically.
    expect(pouch.position.x).toBeCloseTo(0, 5);
    expect(satchel.position.x).not.toBeCloseTo(0, 2);
  });

  it("carry: ['tool-belt'] renders a carry_tool_belt band plus tool cylinders around the waist", () => {
    const rich = appearanceWithCarry(['tool-belt']);
    const { group } = buildEnhancedAvatar(rich);
    const band = findMeshByName(group, 'carry_tool_belt');
    expect(band).toBeDefined();
    expect(band).toBeInstanceOf(THREE.Mesh);
    expect((band as THREE.Mesh).geometry).toBeInstanceOf(THREE.TorusGeometry);
    let cylinderCount = 0;
    group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.CylinderGeometry) cylinderCount++;
    });
    expect(cylinderCount).toBeGreaterThanOrEqual(3); // the 3 deterministic tool angles
  });

  it("carry: ['tome'] renders a carry_tome group with a cover + a lighter pages sliver", () => {
    const rich = appearanceWithCarry(['tome']);
    const { group } = buildEnhancedAvatar(rich);
    const tome = findMeshByName(group, 'carry_tome') as THREE.Group;
    expect(tome).toBeDefined();
    expect(tome).toBeInstanceOf(THREE.Group);
    expect(tome.children.length).toBe(2); // cover + pages
    const [cover, pages] = tome.children as THREE.Mesh[];
    const coverColor = (cover.material as THREE.MeshStandardMaterial).color.getHexString();
    const pagesColor = (pages.material as THREE.MeshStandardMaterial).color.getHexString();
    expect(pagesColor).not.toBe(coverColor); // two-tone, reads as a book not a plain box
  });

  it('satchel + tome + tool-belt + pouch all together render all four, no cross-clobbering', () => {
    const rich = appearanceWithCarry(['satchel', 'tome', 'tool-belt', 'pouch']);
    const { group } = buildEnhancedAvatar(rich);
    expect(findMeshByName(group, 'carry_satchel')).toBeDefined();
    expect(findMeshByName(group, 'carry_tome')).toBeDefined();
    expect(findMeshByName(group, 'carry_tool_belt')).toBeDefined();
    expect(findMeshByName(group, 'carry_pouch')).toBeDefined();
  });

  it('a bare-hands appearance with no carry items renders none of the four props', () => {
    const rich = appearanceWithCarry([]);
    const { group } = buildEnhancedAvatar(rich);
    expect(findMeshByName(group, 'carry_satchel')).toBeUndefined();
    expect(findMeshByName(group, 'carry_tome')).toBeUndefined();
    expect(findMeshByName(group, 'carry_tool_belt')).toBeUndefined();
    expect(findMeshByName(group, 'carry_pouch')).toBeUndefined();
  });

  it('respects clothing.belt.color when set, falling back to a leather-brown default otherwise', () => {
    const withBelt = generateAppearance({
      id: 'test-npc-belt', worldId: 'test-world', themeId: 'classic',
      override: {
        accessories: { jewelry: [], markings: [], carry: ['satchel'], augments: [] },
        clothing: {
          top: { color: '#333333', kind: 'shirt' },
          bottom: { color: '#333333', kind: 'pants' },
          belt: { color: '#123456' },
        },
      },
    });
    const { group } = buildEnhancedAvatar(withBelt);
    const satchel = findMeshByName(group, 'carry_satchel') as THREE.Mesh;
    const mat = satchel.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('123456');
  });
});
