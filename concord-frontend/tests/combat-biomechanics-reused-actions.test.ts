// PR #868 Residual 1 — the combo-step tokens spell/ranged/throw ride reused
// action-biomechanics archetypes and must produce a playable clip on BOTH a
// canonical (hero-GLB) skeleton and the default procedural lowercase skeleton.
// This pins the bone-alias map bidirectionally: without it the procedural rig
// gets zero tracks.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildBiomechClip, buildBiomechClipMap } from '@/lib/concordia/combat-biomechanics';

function skeletonFrom(names: string[]): THREE.Skeleton {
  const bones = names.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  return new THREE.Skeleton(bones);
}

// Mixamo-canonical names (hero-GLB rigs).
const CANONICAL = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'];
// AvatarSystem3D BONE_HIERARCHY (default procedural rig, lowercase).
const PROCEDURAL = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

describe('combat-biomechanics reused actions (spell/ranged/throw)', () => {
  for (const action of ['spell', 'ranged', 'throw'] as const) {
    it(`${action}: non-null clip with ≥1 track on a CANONICAL skeleton`, () => {
      const clip = buildBiomechClip(action, skeletonFrom(CANONICAL), { tier: 3 });
      expect(clip).not.toBeNull();
      expect(clip!.tracks.length).toBeGreaterThanOrEqual(1);
    });

    it(`${action}: non-null clip with ≥1 track on a PROCEDURAL lowercase skeleton (alias map)`, () => {
      const clip = buildBiomechClip(action, skeletonFrom(PROCEDURAL), { tier: 3 });
      expect(clip).not.toBeNull();
      expect(clip!.tracks.length).toBeGreaterThanOrEqual(1);
      // tracks must target REAL procedural bone names (aliased), never a
      // canonical name the skeleton doesn't have.
      const boneSet = new Set(PROCEDURAL);
      for (const t of clip!.tracks) {
        const bone = t.name.split('.')[0];
        expect(boneSet.has(bone)).toBe(true);
      }
    });
  }

  it('the existing tiered actions ALSO gain tracks on the procedural rig via the alias map', () => {
    const clip = buildBiomechClip('attack-light', skeletonFrom(PROCEDURAL), { tier: 4 });
    expect(clip).not.toBeNull();
    expect(clip!.tracks.length).toBeGreaterThanOrEqual(1);
  });

  it('buildBiomechClipMap default action list includes spell/ranged/throw at all tiers', () => {
    const map = buildBiomechClipMap(skeletonFrom(PROCEDURAL));
    for (const a of ['spell', 'ranged', 'throw', 'attack-light']) {
      for (const t of [1, 2, 3, 4, 5]) {
        expect(map[`${a}-t${t}`]).toBeTruthy();
      }
    }
  });
});
