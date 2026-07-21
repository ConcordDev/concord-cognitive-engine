import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { attachArmorToHeroMesh, buildBoneMap } from '@/lib/concordia/hero-mesh-registry';
import type { ArmorAppearance } from '@/lib/concordia/armor-system';
import { clearProceduralCache } from '@/lib/world-lens/procedural-texture';

function boneTreeWithOffsets(entries: Array<[string, [number, number, number]]>): THREE.Group {
  const root = new THREE.Group();
  for (const [name, pos] of entries) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...pos);
    root.add(bone);
  }
  return root;
}

const ARMOR: ArmorAppearance = {
  silhouette: 'heavy_plate',
  primaryColor: '#334455',
  secondaryColor: '#223344',
  accentColor: '#aa8822',
  tier: 3,
  wear: 0.2,
  seed: 'test-hero-armor',
};

// 2026-07-21 — hero GLB NPCs (real Rocketbox/Mixamo meshes) previously
// wore no armor at all — armor-system.ts's output only ever reached the
// procedural body (enhanced-avatar-builder.ts). attachArmorToHeroMesh
// uses the standard three.js Object3D.attach() technique to parent
// real-material-detail armor pieces onto the loaded skeleton's bones.
describe('attachArmorToHeroMesh', () => {
  it('attaches all 4 slots when every required bone exists on the skeleton', () => {
    clearProceduralCache();
    const root = boneTreeWithOffsets([
      ['Hips', [0, 0.9, 0]],
      ['Spine2', [0, 1.3, 0]],
      ['Head', [0, 1.7, 0]],
    ]);
    const boneMap = buildBoneMap(root);
    attachArmorToHeroMesh(root, boneMap, ARMOR);

    const armorGroups: THREE.Group[] = [];
    root.traverse((obj) => { if ((obj as THREE.Group).userData?.isArmor) armorGroups.push(obj as THREE.Group); });
    const slots = armorGroups.map((g) => g.userData.slot).sort();
    expect(slots).toEqual(['arms', 'head', 'legs', 'torso']);
  });

  it('parents each slot to the correct bone (torso/legs -> Hips, arms -> Spine2, head -> Head)', () => {
    clearProceduralCache();
    const root = boneTreeWithOffsets([
      ['Hips', [0, 0.9, 0]],
      ['Spine2', [0, 1.3, 0]],
      ['Head', [0, 1.7, 0]],
    ]);
    const boneMap = buildBoneMap(root);
    attachArmorToHeroMesh(root, boneMap, ARMOR);

    const bySlot = new Map<string, THREE.Object3D>();
    root.traverse((obj) => {
      if ((obj as THREE.Group).userData?.isArmor) bySlot.set((obj as THREE.Group).userData.slot, obj.parent!);
    });
    expect(bySlot.get('head')).toBe(boneMap.get('Head'));
    expect(bySlot.get('torso')).toBe(boneMap.get('Hips'));
    expect(bySlot.get('legs')).toBe(boneMap.get('Hips'));
    expect(bySlot.get('arms')).toBe(boneMap.get('Spine2'));
  });

  it('positions each piece at its bone\'s real world position (not the mesh local origin)', () => {
    clearProceduralCache();
    const root = boneTreeWithOffsets([
      ['Hips', [0, 0.9, 0]],
      ['Spine2', [0, 1.3, 0]],
      ['Head', [0.05, 1.7, 0]],
    ]);
    const boneMap = buildBoneMap(root);
    attachArmorToHeroMesh(root, boneMap, ARMOR);

    const headPiece = [...root.children].flatMap((c) => c.children).find((c) => (c as THREE.Group).userData?.slot === 'head')
      ?? (boneMap.get('Head')!.children.find((c) => (c as THREE.Group).userData?.slot === 'head'));
    expect(headPiece).toBeTruthy();
    const worldPos = new THREE.Vector3();
    headPiece!.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(0.05, 5);
    expect(worldPos.y).toBeCloseTo(1.7, 5);
  });

  it('falls back through the arms bone chain (Spine2 -> Spine1 -> Spine) when Spine2 is absent', () => {
    clearProceduralCache();
    const root = boneTreeWithOffsets([
      ['Hips', [0, 0.9, 0]],
      ['Spine1', [0, 1.2, 0]],
      ['Head', [0, 1.7, 0]],
    ]);
    const boneMap = buildBoneMap(root);
    attachArmorToHeroMesh(root, boneMap, ARMOR);
    const armsPiece = boneMap.get('Spine1')!.children.find((c) => (c as THREE.Group).userData?.slot === 'arms');
    expect(armsPiece).toBeTruthy();
  });

  it('skips a slot gracefully (no throw) when NO candidate bone exists for it', () => {
    clearProceduralCache();
    // No Hips at all — torso and legs have nowhere to attach.
    const root = boneTreeWithOffsets([['Head', [0, 1.7, 0]]]);
    const boneMap = buildBoneMap(root);
    expect(() => attachArmorToHeroMesh(root, boneMap, ARMOR)).not.toThrow();
    const armorGroups: THREE.Group[] = [];
    root.traverse((obj) => { if ((obj as THREE.Group).userData?.isArmor) armorGroups.push(obj as THREE.Group); });
    expect(armorGroups.map((g) => g.userData.slot).sort()).toEqual(['head']);
  });

  it('every attached material carries real-reference normalMap/roughnessMap detail', () => {
    clearProceduralCache();
    const root = boneTreeWithOffsets([['Hips', [0, 0.9, 0]], ['Head', [0, 1.7, 0]]]);
    const boneMap = buildBoneMap(root);
    attachArmorToHeroMesh(root, boneMap, ARMOR);
    let checked = 0;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if ((mesh as THREE.Mesh).isMesh && mesh.material) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.normalMap !== undefined) {
          expect(mat.normalMap).toBeTruthy();
          expect(mat.roughnessMap).toBeTruthy();
          checked++;
        }
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('is a pure attachment call — armor pieces are real children of the bone in the object graph, so they move with the rig', () => {
    clearProceduralCache();
    const root = boneTreeWithOffsets([['Hips', [0, 0.9, 0]]]);
    const boneMap = buildBoneMap(root);
    attachArmorToHeroMesh(root, boneMap, ARMOR);
    const hips = boneMap.get('Hips')!;
    const torsoPiece = hips.children.find((c) => (c as THREE.Group).userData?.slot === 'torso')!;
    // Move the bone -> the armor piece's world position must move with it.
    const before = new THREE.Vector3();
    torsoPiece.getWorldPosition(before);
    hips.position.y += 0.5;
    hips.updateMatrixWorld(true);
    const after = new THREE.Vector3();
    torsoPiece.getWorldPosition(after);
    expect(after.y - before.y).toBeCloseTo(0.5, 5);
  });
});
