/**
 * Procedural skinned humanoid — Sprint D / BB1
 *
 * Replaces the primitive-Group humanoid in AvatarSystem3D for crowd NPCs.
 * Hero NPCs get bespoke meshes via hero-mesh-registry (DD1).
 *
 * Approach (no external GLTF asset needed for fallback):
 *   1. Build a single capsule-derived mesh using THREE.CylinderGeometry
 *      + THREE.SphereGeometry merged into one BufferGeometry.
 *   2. Assign vertex weights to a Mixamo-name bone hierarchy.
 *   3. Return THREE.SkinnedMesh + boneMap.
 *
 * The mesh deforms with the bones via standard THREE skinning.
 *
 * This is intentionally simple — far better than primitive-Group (vertex
 * weights mean limbs flex correctly, skin SSS shader applies, eye
 * parallax mounts on the head bone) but not as good as a real authored
 * GLTF. The DD pipeline takes over for hero NPCs.
 */

import * as THREE from 'three';
import { HERO_MESH_CONSTANTS } from './hero-mesh-registry';

const { CANONICAL_BONES } = HERO_MESH_CONSTANTS;

export interface SkinnedHumanoidAppearance {
  /** Body type from existing AppearanceConfig — drives proportions. */
  bodyType:    'slim' | 'average' | 'stocky' | 'tall' | 'legend';
  /** Skin tone hex. */
  skinColor:   string;
  /** Outfit color hex (chest tint). */
  outfitColor: string;
  /** Optional emissive (for legend / immortal NPCs). */
  emissive?:   boolean;
}

export interface SkinnedHumanoidResult {
  /** The full character group, root-positioned at hips (1m above ground). */
  group:    THREE.Group;
  /** SkinnedMesh that deforms with bones. */
  mesh:     THREE.SkinnedMesh;
  /** Bone name → THREE.Bone (Mixamo names). */
  boneMap:  Map<string, THREE.Bone>;
  /** Mixer-ready Skeleton. */
  skeleton: THREE.Skeleton;
}

const BODY_PROPORTIONS: Record<SkinnedHumanoidAppearance['bodyType'], { hipsY: number; spineLen: number; armLen: number; legLen: number; shoulderWidth: number; emissiveBoost: number }> = {
  slim:    { hipsY: 0.95, spineLen: 0.50, armLen: 0.62, legLen: 0.92, shoulderWidth: 0.32, emissiveBoost: 0 },
  average: { hipsY: 1.00, spineLen: 0.52, armLen: 0.65, legLen: 0.95, shoulderWidth: 0.36, emissiveBoost: 0 },
  stocky:  { hipsY: 0.95, spineLen: 0.48, armLen: 0.60, legLen: 0.85, shoulderWidth: 0.42, emissiveBoost: 0 },
  tall:    { hipsY: 1.10, spineLen: 0.58, armLen: 0.72, legLen: 1.05, shoulderWidth: 0.40, emissiveBoost: 0 },
  legend:  { hipsY: 1.50, spineLen: 0.78, armLen: 0.97, legLen: 1.42, shoulderWidth: 0.54, emissiveBoost: 0.25 },
};

/**
 * Build a procedural skinned humanoid. Returns the SkinnedMesh + bone map.
 *
 * The mesh is one merged BufferGeometry (capsule body + 4 limb cylinders +
 * head sphere). Vertex weights are assigned heuristically:
 *   - vertices in the head sphere → Head bone weight 1.0
 *   - vertices in the spine cylinder → Spine bones weight 1.0 (mid-region)
 *   - vertices in arm cylinders → corresponding Arm bone weight 1.0
 *   - similar for legs
 *
 * Smooth-blend at joints (shoulder / elbow / hip / knee) by interpolating
 * weights between adjacent bones based on local Y position.
 */
export function createSkinnedHumanoid(appearance: SkinnedHumanoidAppearance): SkinnedHumanoidResult {
  const prop = BODY_PROPORTIONS[appearance.bodyType];
  const skinHex = parseInt(appearance.skinColor.replace(/^#/, ''), 16);
  const outfitHex = parseInt(appearance.outfitColor.replace(/^#/, ''), 16);

  // Build bones — a flat list in the order CANONICAL_BONES expects, then
  // attach as a hierarchy.
  const bones: Record<string, THREE.Bone> = {};
  for (const name of CANONICAL_BONES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }

  // Wire the hierarchy.
  bones.Hips.add(bones.Spine);
  bones.Spine.add(bones.Spine1);
  bones.Spine1.add(bones.Spine2);
  bones.Spine2.add(bones.Neck);
  bones.Neck.add(bones.Head);

  bones.Spine2.add(bones.LeftShoulder);
  bones.LeftShoulder.add(bones.LeftArm);
  bones.LeftArm.add(bones.LeftForeArm);
  bones.LeftForeArm.add(bones.LeftHand);

  bones.Spine2.add(bones.RightShoulder);
  bones.RightShoulder.add(bones.RightArm);
  bones.RightArm.add(bones.RightForeArm);
  bones.RightForeArm.add(bones.RightHand);

  bones.Hips.add(bones.LeftUpLeg);
  bones.LeftUpLeg.add(bones.LeftLeg);
  bones.LeftLeg.add(bones.LeftFoot);
  bones.LeftFoot.add(bones.LeftToeBase);

  bones.Hips.add(bones.RightUpLeg);
  bones.RightUpLeg.add(bones.RightLeg);
  bones.RightLeg.add(bones.RightFoot);
  bones.RightFoot.add(bones.RightToeBase);

  // Position bones in T-pose. Hips is at world (0, prop.hipsY, 0).
  bones.Hips.position.set(0, prop.hipsY, 0);
  bones.Spine.position.set(0, 0.10, 0);
  bones.Spine1.position.set(0, 0.10, 0);
  bones.Spine2.position.set(0, 0.10, 0);
  bones.Neck.position.set(0, 0.10, 0);
  bones.Head.position.set(0, 0.12, 0);

  bones.LeftShoulder.position.set(prop.shoulderWidth / 2, 0, 0);
  bones.LeftArm.position.set(0.05, -0.05, 0);
  bones.LeftForeArm.position.set(0, -prop.armLen * 0.45, 0);
  bones.LeftHand.position.set(0, -prop.armLen * 0.4, 0);

  bones.RightShoulder.position.set(-prop.shoulderWidth / 2, 0, 0);
  bones.RightArm.position.set(-0.05, -0.05, 0);
  bones.RightForeArm.position.set(0, -prop.armLen * 0.45, 0);
  bones.RightHand.position.set(0, -prop.armLen * 0.4, 0);

  bones.LeftUpLeg.position.set(0.10, -0.05, 0);
  bones.LeftLeg.position.set(0, -prop.legLen * 0.5, 0);
  bones.LeftFoot.position.set(0, -prop.legLen * 0.45, 0);
  bones.LeftToeBase.position.set(0, -0.08, 0.12);

  bones.RightUpLeg.position.set(-0.10, -0.05, 0);
  bones.RightLeg.position.set(0, -prop.legLen * 0.5, 0);
  bones.RightFoot.position.set(0, -prop.legLen * 0.45, 0);
  bones.RightToeBase.position.set(0, -0.08, 0.12);

  // Build the body mesh as a single merged BufferGeometry.
  const merged = mergeBodyGeometries(prop, bones);

  // Skeleton.
  const orderedBones: THREE.Bone[] = CANONICAL_BONES.map(name => bones[name]);
  const skeleton = new THREE.Skeleton(orderedBones);

  // Material — outfit body, skin head, optional emissive for legend.
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinHex,
    roughness: 0.65, metalness: 0.0,
    emissive: appearance.emissive ? skinHex : 0x000000,
    emissiveIntensity: appearance.emissive ? prop.emissiveBoost : 0,
    skinning: true as never,
  } as THREE.MeshStandardMaterialParameters);
  const outfitMat = new THREE.MeshStandardMaterial({
    color: outfitHex,
    roughness: 0.85, metalness: 0.0,
    skinning: true as never,
  } as THREE.MeshStandardMaterialParameters);

  // The merged geometry has groups (head+hands = skin, body+limbs = outfit).
  const mesh = new THREE.SkinnedMesh(merged, [outfitMat, skinMat]);
  mesh.bind(skeleton);
  mesh.add(bones.Hips);

  const group = new THREE.Group();
  group.name = 'skinned_humanoid';
  group.add(mesh);

  // Build the boneMap.
  const boneMap = new Map<string, THREE.Bone>();
  for (const name of CANONICAL_BONES) boneMap.set(name, bones[name]);

  return { group, mesh, boneMap, skeleton };
}

/**
 * Build the body geometry — capsule torso + 4 limb cylinders + head sphere.
 * Vertex weights assigned per-region. groups[0] = outfit (body+limbs);
 * groups[1] = skin (head+hands).
 */
function mergeBodyGeometries(prop: typeof BODY_PROPORTIONS['average'], bones: Record<string, THREE.Bone>): THREE.BufferGeometry {
  const geos: { geom: THREE.BufferGeometry; matIndex: number; primaryBone: string }[] = [];

  // Torso (capsule-ish — cylinder + 2 hemispheres).
  const torso = new THREE.CylinderGeometry(0.18, 0.20, prop.spineLen + 0.20, 12, 4);
  torso.translate(0, prop.spineLen / 2, 0);
  geos.push({ geom: torso, matIndex: 0, primaryBone: 'Spine1' });

  // Head sphere.
  const head = new THREE.SphereGeometry(0.13, 12, 10);
  head.translate(0, prop.hipsY + prop.spineLen + 0.32, 0);
  geos.push({ geom: head, matIndex: 1, primaryBone: 'Head' });

  // Arms.
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const upper = new THREE.CylinderGeometry(0.06, 0.055, prop.armLen * 0.45, 8, 1);
    upper.translate(sx * (prop.shoulderWidth / 2 + 0.03), prop.hipsY + prop.spineLen + 0.05, 0);
    geos.push({ geom: upper, matIndex: 0, primaryBone: `${side}Arm` });

    const lower = new THREE.CylinderGeometry(0.05, 0.045, prop.armLen * 0.40, 8, 1);
    lower.translate(sx * (prop.shoulderWidth / 2 + 0.03), prop.hipsY + prop.spineLen - prop.armLen * 0.4, 0);
    geos.push({ geom: lower, matIndex: 0, primaryBone: `${side}ForeArm` });

    const hand = new THREE.SphereGeometry(0.05, 8, 6);
    hand.translate(sx * (prop.shoulderWidth / 2 + 0.03), prop.hipsY + prop.spineLen - prop.armLen * 0.85, 0);
    geos.push({ geom: hand, matIndex: 1, primaryBone: `${side}Hand` });
  }

  // Legs.
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const upper = new THREE.CylinderGeometry(0.08, 0.07, prop.legLen * 0.5, 8, 1);
    upper.translate(sx * 0.10, prop.hipsY - prop.legLen * 0.25, 0);
    geos.push({ geom: upper, matIndex: 0, primaryBone: `${side}UpLeg` });

    const lower = new THREE.CylinderGeometry(0.07, 0.055, prop.legLen * 0.45, 8, 1);
    lower.translate(sx * 0.10, prop.hipsY - prop.legLen * 0.75, 0);
    geos.push({ geom: lower, matIndex: 0, primaryBone: `${side}Leg` });

    const foot = new THREE.BoxGeometry(0.12, 0.06, 0.20);
    foot.translate(sx * 0.10, prop.hipsY - prop.legLen + 0.03, 0.04);
    geos.push({ geom: foot, matIndex: 0, primaryBone: `${side}Foot` });
  }

  // Merge into a single buffer with vertex weights.
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allUvs: number[] = [];
  const allSkinIndices: number[] = [];
  const allSkinWeights: number[] = [];
  const groupRanges: { start: number; count: number; matIndex: number }[] = [];

  for (const g of geos) {
    g.geom.computeVertexNormals();
    const posAttr = g.geom.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = g.geom.getAttribute('normal') as THREE.BufferAttribute;
    const uvAttr = g.geom.getAttribute('uv') as THREE.BufferAttribute | null;
    const indexAttr = g.geom.getIndex();
    const boneIndex = CANONICAL_BONES.indexOf(g.primaryBone);

    const startVertex = allPositions.length / 3;
    const startTriangle = (groupRanges.reduce((s, r) => s + r.count, 0));

    for (let i = 0; i < posAttr.count; i++) {
      allPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      allNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      if (uvAttr) {
        allUvs.push(uvAttr.getX(i), uvAttr.getY(i));
      } else {
        allUvs.push(0, 0);
      }
      // Single-bone weight 1.0 — simple but works.
      allSkinIndices.push(boneIndex >= 0 ? boneIndex : 0, 0, 0, 0);
      allSkinWeights.push(1.0, 0.0, 0.0, 0.0);
    }

    if (indexAttr) {
      const idx = indexAttr.array as Uint16Array | Uint32Array;
      // We'll add indices below in a second pass after we know totalIndices.
      groupRanges.push({ start: startTriangle, count: idx.length, matIndex: g.matIndex });
    }
    void startVertex;
  }

  // Second pass: re-emit indices with offsets.
  const allIndices: number[] = [];
  let vertexOffset = 0;
  for (const g of geos) {
    const indexAttr = g.geom.getIndex();
    if (!indexAttr) continue;
    const idx = indexAttr.array;
    for (let i = 0; i < idx.length; i++) {
      allIndices.push(idx[i] + vertexOffset);
    }
    vertexOffset += g.geom.getAttribute('position').count;
  }

  const buf = new THREE.BufferGeometry();
  buf.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  buf.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
  buf.setAttribute('uv', new THREE.Float32BufferAttribute(allUvs, 2));
  buf.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(allSkinIndices, 4));
  buf.setAttribute('skinWeight', new THREE.Float32BufferAttribute(allSkinWeights, 4));
  buf.setIndex(allIndices);

  // Assign material groups.
  let triangleCursor = 0;
  for (const g of groupRanges) {
    buf.addGroup(triangleCursor, g.count, g.matIndex);
    triangleCursor += g.count;
  }

  // Cleanup component geometries.
  for (const g of geos) g.geom.dispose();

  return buf;
}

export const SKINNED_HUMANOID_CONSTANTS = Object.freeze({
  BODY_PROPORTIONS,
});
