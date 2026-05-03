/**
 * combat-clips.ts
 *
 * Procedural combat animation clips. Generates THREE.AnimationClip objects
 * for attack-light / attack-heavy / block / parry / dodge-{l,r,back} /
 * hit-flinch / death using simple keyframed quaternion + position tracks.
 *
 * No external animation files required — clips are computed at runtime from
 * a small table of keyframe poses. Each clip targets a humanoid skeleton
 * with the bone names used elsewhere in the project (Spine, RightArm,
 * RightForeArm, LeftArm, LeftForeArm, Head, Hips). Bones that don't exist
 * on the target rig are silently ignored.
 *
 * Public API:
 *   buildCombatClipMap(skeleton)   — returns Record<animName, THREE.AnimationClip>
 *   playCombatClip(mixer, name, clipMap, opts) — crossfade into clip
 */

import * as THREE from 'three';

type CombatAnim =
  | 'attack-light'
  | 'attack-heavy'
  | 'block'
  | 'parry'
  | 'dodge-left'
  | 'dodge-right'
  | 'dodge-back'
  | 'hit-flinch'
  | 'death';

interface KeyPose {
  t: number;
  bones: Record<string, { rot?: [number, number, number]; pos?: [number, number, number] }>;
}

// All angles are Euler XYZ in radians. Bones not listed in a pose carry over
// from the previous keyframe's value. Time is seconds.
const POSE_TABLE: Record<CombatAnim, KeyPose[]> = {
  'attack-light': [
    { t: 0.0,  bones: { RightArm: { rot: [-0.4, 0, 0.2] }, RightForeArm: { rot: [0, 0, 0] }, Spine: { rot: [0, -0.1, 0] } } },
    { t: 0.15, bones: { RightArm: { rot: [-1.6, 0.2, 0.4] }, RightForeArm: { rot: [-0.6, 0, 0] }, Spine: { rot: [0, 0.2, 0] } } },
    { t: 0.30, bones: { RightArm: { rot: [-1.0, -0.3, -0.2] }, RightForeArm: { rot: [-1.4, 0, 0] }, Spine: { rot: [0, -0.4, 0] } } },
    { t: 0.45, bones: { RightArm: { rot: [-0.4, 0, 0.2] }, RightForeArm: { rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
  ],
  'attack-heavy': [
    { t: 0.0,  bones: { RightArm: { rot: [-0.4, 0, 0.2] }, Spine: { rot: [0, -0.1, 0] }, Hips: { pos: [0, 0, 0] } } },
    { t: 0.30, bones: { RightArm: { rot: [-2.4, 0.4, 0.6] }, RightForeArm: { rot: [-0.8, 0, 0] }, Spine: { rot: [0, 0.5, 0] }, Hips: { pos: [0, -0.05, -0.1] } } },
    { t: 0.55, bones: { RightArm: { rot: [-0.6, -0.5, -0.4] }, RightForeArm: { rot: [-1.6, 0, 0] }, Spine: { rot: [0, -0.6, 0] }, Hips: { pos: [0, -0.02, 0.15] } } },
    { t: 0.90, bones: { RightArm: { rot: [-0.4, 0, 0.2] }, RightForeArm: { rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] }, Hips: { pos: [0, 0, 0] } } },
  ],
  block: [
    { t: 0.0,  bones: { LeftArm: { rot: [-0.6, 0.2, 0.4] }, LeftForeArm: { rot: [-1.0, 0, 0] }, RightArm: { rot: [-0.4, 0, 0.2] } } },
    { t: 0.10, bones: { LeftArm: { rot: [-1.4, 0.3, 0.6] }, LeftForeArm: { rot: [-1.7, 0, 0] }, RightArm: { rot: [-0.6, 0, 0.3] } } },
    { t: 1.20, bones: { LeftArm: { rot: [-1.4, 0.3, 0.6] }, LeftForeArm: { rot: [-1.7, 0, 0] } } }, // hold
  ],
  parry: [
    { t: 0.0,  bones: { LeftArm: { rot: [-0.6, 0.2, 0.4] }, LeftForeArm: { rot: [-1.0, 0, 0] } } },
    { t: 0.08, bones: { LeftArm: { rot: [-1.6, 0.5, 0.8] }, LeftForeArm: { rot: [-2.2, 0, 0] }, Spine: { rot: [0, 0.3, 0] } } },
    { t: 0.30, bones: { LeftArm: { rot: [-0.4, 0, 0.2] }, LeftForeArm: { rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
  ],
  'dodge-left': [
    { t: 0.0,  bones: { Hips: { pos: [0, 0, 0], rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
    { t: 0.20, bones: { Hips: { pos: [-0.6, -0.1, 0], rot: [0, 0, -0.3] }, Spine: { rot: [0, 0, -0.2] } } },
    { t: 0.50, bones: { Hips: { pos: [0, 0, 0], rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
  ],
  'dodge-right': [
    { t: 0.0,  bones: { Hips: { pos: [0, 0, 0], rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
    { t: 0.20, bones: { Hips: { pos: [0.6, -0.1, 0], rot: [0, 0, 0.3] }, Spine: { rot: [0, 0, 0.2] } } },
    { t: 0.50, bones: { Hips: { pos: [0, 0, 0], rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
  ],
  'dodge-back': [
    { t: 0.0,  bones: { Hips: { pos: [0, 0, 0], rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
    { t: 0.25, bones: { Hips: { pos: [0, -0.15, -0.7], rot: [0.2, 0, 0] }, Spine: { rot: [0.2, 0, 0] } } },
    { t: 0.60, bones: { Hips: { pos: [0, 0, 0], rot: [0, 0, 0] }, Spine: { rot: [0, 0, 0] } } },
  ],
  'hit-flinch': [
    { t: 0.0,  bones: { Spine: { rot: [0, 0, 0] }, Head: { rot: [0, 0, 0] } } },
    { t: 0.08, bones: { Spine: { rot: [0.3, 0, 0.1] }, Head: { rot: [0.4, 0, 0] }, Hips: { pos: [0, 0, -0.15] } } },
    { t: 0.35, bones: { Spine: { rot: [0, 0, 0] }, Head: { rot: [0, 0, 0] }, Hips: { pos: [0, 0, 0] } } },
  ],
  death: [
    { t: 0.0,  bones: { Spine: { rot: [0, 0, 0] }, Hips: { rot: [0, 0, 0], pos: [0, 0, 0] } } },
    { t: 0.4,  bones: { Spine: { rot: [0.4, 0, 0] }, Hips: { rot: [0.2, 0, 0], pos: [0, -0.2, 0] } } },
    { t: 1.2,  bones: { Spine: { rot: [1.2, 0, 0] }, Hips: { rot: [1.0, 0, 0.2], pos: [0, -0.6, 0.2] } } },
    { t: 2.0,  bones: { Spine: { rot: [1.4, 0, 0] }, Hips: { rot: [1.4, 0, 0.4], pos: [0, -0.7, 0.3] } } },
  ],
};

function eulerToQuat(e: [number, number, number]): [number, number, number, number] {
  const q = new THREE.Quaternion();
  q.setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
  return [q.x, q.y, q.z, q.w];
}

/**
 * Build the full clip map for a given skeleton. Bones missing on the
 * skeleton are skipped — the rest of the clip still plays.
 */
export function buildCombatClipMap(skeleton: THREE.Skeleton): Record<CombatAnim, THREE.AnimationClip> {
  const boneSet = new Set(skeleton.bones.map((b) => b.name));
  const clips: Record<string, THREE.AnimationClip> = {};

  for (const [name, poses] of Object.entries(POSE_TABLE) as Array<[CombatAnim, KeyPose[]]>) {
    const tracks: THREE.KeyframeTrack[] = [];

    // Collect every bone touched by this clip.
    const touched = new Set<string>();
    for (const p of poses) for (const b of Object.keys(p.bones)) touched.add(b);

    for (const boneName of touched) {
      if (!boneSet.has(boneName)) continue;

      // Build a track of rotation keyframes for this bone.
      const rotTimes: number[] = [];
      const rotValues: number[] = [];
      const posTimes: number[] = [];
      const posValues: number[] = [];

      // Carry-forward semantics: if a pose doesn't list rot/pos for the bone,
      // we don't add a keyframe at that time — the linear interp between the
      // last and next keyframe handles it.
      for (const p of poses) {
        const entry = p.bones[boneName];
        if (entry?.rot) {
          rotTimes.push(p.t);
          const q = eulerToQuat(entry.rot);
          rotValues.push(...q);
        }
        if (entry?.pos) {
          posTimes.push(p.t);
          posValues.push(...entry.pos);
        }
      }

      if (rotTimes.length >= 2) {
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, rotTimes, rotValues));
      }
      if (posTimes.length >= 2) {
        tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, posTimes, posValues));
      }
    }

    if (tracks.length === 0) continue;
    const duration = poses[poses.length - 1].t;
    clips[name] = new THREE.AnimationClip(name, duration, tracks);
  }

  return clips as Record<CombatAnim, THREE.AnimationClip>;
}

/**
 * Crossfade into a combat clip on an existing AnimationMixer.
 */
export function playCombatClip(
  mixer: THREE.AnimationMixer,
  name: CombatAnim,
  clipMap: Record<CombatAnim, THREE.AnimationClip>,
  opts: { fadeMs?: number; weight?: number; loop?: boolean } = {},
): THREE.AnimationAction | null {
  const clip = clipMap[name];
  if (!clip) return null;
  const fade = (opts.fadeMs ?? 100) / 1000;

  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(opts.loop ? THREE.LoopRepeat : THREE.LoopOnce, opts.loop ? Infinity : 1);
  action.clampWhenFinished = name === 'death';
  action.fadeIn(fade);
  action.setEffectiveWeight(opts.weight ?? 1);
  action.play();
  return action;
}
