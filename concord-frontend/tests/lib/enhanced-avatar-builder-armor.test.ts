import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildEnhancedAvatar } from '@/lib/world-lens/enhanced-avatar-builder';
import { generateAppearance } from '@/lib/world-lens/character-schema';
import { clearProceduralCache } from '@/lib/world-lens/procedural-texture';

function richFor(id: string, archetype: string | null, overrides: Parameters<typeof generateAppearance>[0]['override'] = {}) {
  return generateAppearance({ id, worldId: 'concordia-hub', archetype, themeId: 'concordia-hub', override: overrides });
}

function armorMaterials(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  group.traverse((obj) => {
    if ((obj as THREE.Group).userData?.isArmor) {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as THREE.Mesh).isMesh) out.push(mesh.material as THREE.MeshStandardMaterial);
      });
    }
  });
  return out;
}

// 2026-07-21 — buildEnhancedAvatar previously built the body only; armor
// (character-schema.ts's deterministic per-character armor block) was
// generated but never attached. Every character using this builder (the
// local player + every hero-flagged NPC) now wears their armor kit.
describe('buildEnhancedAvatar — armor attachment', () => {
  it('attaches all 4 armor slots (head/torso/arms/legs) as real userData-tagged groups', () => {
    clearProceduralCache();
    const rich = richFor('npc_armor_attach_1', 'warrior');
    const { group } = buildEnhancedAvatar(rich);
    const armorGroups: THREE.Group[] = [];
    group.traverse((obj) => {
      if ((obj as THREE.Group).userData?.isArmor) armorGroups.push(obj as THREE.Group);
    });
    const slots = armorGroups.map((g) => g.userData.slot).sort();
    expect(slots).toEqual(['arms', 'head', 'legs', 'torso']);
  });

  it('every armor material carries real-reference normalMap/roughnessMap detail', () => {
    clearProceduralCache();
    const rich = richFor('npc_armor_attach_2', 'guard');
    const { group } = buildEnhancedAvatar(rich);
    const mats = armorMaterials(group);
    expect(mats.length).toBeGreaterThan(0);
    for (const mat of mats) {
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
    }
  });

  it('armor is scaled by totalHeight / 1.75 to stay proportionate on every archetype', () => {
    clearProceduralCache();
    const armorScaleOf = (g: THREE.Group) => {
      let scale = 0;
      g.traverse((obj) => { if ((obj as THREE.Group).userData?.isArmor) scale = (obj as THREE.Group).scale.x; });
      return scale;
    };
    // Sample several ids so the seeded bodyArchetype pick lands on a real
    // spread of heights (slim/average/stocky/tall/broad/petite/legend) —
    // the scale formula must track totalHeight for whichever archetype
    // each character's own seed actually produced.
    for (let i = 0; i < 8; i++) {
      const rich = richFor(`npc_scale_sample_${i}`, 'trader');
      const scale = armorScaleOf(buildEnhancedAvatar(rich).group);
      expect(scale).toBeCloseTo(rich.totalHeight / 1.75, 5);
    }
  });

  it('a manually-constructed taller RichAppearanceConfig gets proportionately larger armor', () => {
    clearProceduralCache();
    // Bypass generateAppearance's seeded bodyArchetype pick entirely
    // (override does not cascade into proportions — a pre-existing
    // characteristic of that function, not something this test should
    // fight) by constructing two full RichAppearanceConfig objects by
    // hand with only totalHeight/proportions differing, isolating the
    // scale formula itself.
    const base = richFor('npc_scale_isolation_base', 'trader');
    const tall = { ...base, totalHeight: 2.1, proportions: { ...base.proportions, totalHeight: 2.1 } };
    const short = { ...base, totalHeight: 1.55, proportions: { ...base.proportions, totalHeight: 1.55 } };
    const armorScaleOf = (g: THREE.Group) => {
      let scale = 0;
      g.traverse((obj) => { if ((obj as THREE.Group).userData?.isArmor) scale = (obj as THREE.Group).scale.x; });
      return scale;
    };
    const tallScale = armorScaleOf(buildEnhancedAvatar(tall).group);
    const shortScale = armorScaleOf(buildEnhancedAvatar(short).group);
    expect(tallScale).toBeCloseTo(2.1 / 1.75, 5);
    expect(shortScale).toBeCloseTo(1.55 / 1.75, 5);
    expect(tallScale).toBeGreaterThan(shortScale);
  });

  it('armor slots anchor at the correct body landmarks (head/shoulder/waist lines)', () => {
    clearProceduralCache();
    const rich = richFor('npc_anchor_test', 'warrior');
    const { group } = buildEnhancedAvatar(rich);
    const p = rich.proportions;
    const anchors: Record<string, number> = {};
    group.traverse((obj) => {
      const g = obj as THREE.Group;
      if (g.userData?.isArmor) anchors[g.userData.slot] = g.position.y;
    });
    const headY = p.legLength + p.torsoLength + p.neckLength + p.headHeight / 2;
    const shoulderY = p.legLength + p.torsoLength;
    const waistY = p.legLength;
    expect(anchors.head).toBeCloseTo(headY, 5);
    expect(anchors.arms).toBeCloseTo(shoulderY, 5);
    expect(anchors.torso).toBeCloseTo(waistY, 5);
    expect(anchors.legs).toBeCloseTo(waistY, 5);
  });

  it('two different characters with different armor seeds get different (non-shared) armor textures', () => {
    clearProceduralCache();
    const a = richFor('npc_unique_a', 'warrior');
    const b = richFor('npc_unique_b', 'warrior');
    expect(a.armor.seed).not.toBe(b.armor.seed);
    const matsA = armorMaterials(buildEnhancedAvatar(a).group);
    const matsB = armorMaterials(buildEnhancedAvatar(b).group);
    expect(matsA[0].normalMap).not.toBe(matsB[0].normalMap);
  });

  it('dispose() does not throw with armor attached', () => {
    clearProceduralCache();
    const rich = richFor('npc_dispose_test', 'mystic');
    const result = buildEnhancedAvatar(rich);
    expect(() => result.dispose()).not.toThrow();
  });

  it('never throws across every archetype (all 4 default silhouettes + civilian)', () => {
    clearProceduralCache();
    const archetypes = ['warrior', 'guard', 'scholar', 'mystic', 'hunter', 'trader', null];
    for (const archetype of archetypes) {
      const rich = richFor(`npc_arch_${archetype ?? 'civ'}`, archetype);
      expect(() => buildEnhancedAvatar(rich)).not.toThrow();
    }
  });
});
