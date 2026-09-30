import * as THREE from "three";

function q(x: number, y: number, z: number): number[] {
  const e = new THREE.Euler(x, y, z, "XYZ");
  const quat = new THREE.Quaternion().setFromEuler(e);
  return [quat.x, quat.y, quat.z, quat.w];
}

function armTrack(name: string, times: number[], eulers: number[][]) {
  const values: number[] = [];
  for (const e of eulers) values.push(...q(e[0]!, e[1]!, e[2]!));
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
}

/** Mixamo-bone slash / heavy / hit / jump clips for the Soldier rig. */
export function mixamoCombatClips(): Record<string, THREE.AnimationClip> {
  const slashT = [0, 0.12, 0.22, 0.38, 0.52];
  const slash = new THREE.AnimationClip("Slash", 0.52, [
    armTrack("mixamorig:RightArm", slashT, [
      [-0.4, 0.1, 0.35],
      [-1.55, 0.55, 0.45],
      [1.85, -0.65, -0.35],
      [0.9, -0.25, 0.1],
      [-0.35, 0.1, 0.3],
    ]),
    armTrack("mixamorig:RightForeArm", slashT, [
      [-0.2, 0, 0],
      [-0.55, 0.2, 0],
      [0.35, -0.1, 0],
      [0.1, 0, 0],
      [-0.2, 0, 0],
    ]),
    armTrack("mixamorig:Spine1", slashT, [
      [0, 0, 0],
      [0.1, 0.35, 0],
      [0.15, -0.55, 0],
      [0.05, -0.15, 0],
      [0, 0, 0],
    ]),
    armTrack("mixamorig:LeftArm", slashT, [
      [0.2, 0, -0.2],
      [0.45, 0.2, -0.35],
      [0.15, -0.1, -0.15],
      [0.1, 0, -0.15],
      [0.2, 0, -0.2],
    ]),
  ]);

  const heavyT = [0, 0.2, 0.38, 0.52, 0.82];
  const heavy = new THREE.AnimationClip("Heavy", 0.82, [
    armTrack("mixamorig:RightArm", heavyT, [
      [-0.5, 0.2, 0.4],
      [-2.05, 0.7, 0.55],
      [2.15, -0.85, -0.5],
      [1.1, -0.3, 0],
      [-0.35, 0.1, 0.3],
    ]),
    armTrack("mixamorig:RightForeArm", heavyT, [
      [-0.15, 0, 0],
      [-0.7, 0.25, 0],
      [0.45, -0.15, 0],
      [0.15, 0, 0],
      [-0.15, 0, 0],
    ]),
    armTrack("mixamorig:Spine1", heavyT, [
      [0, 0, 0],
      [0.2, 0.5, 0],
      [0.25, -0.7, 0],
      [0.08, -0.2, 0],
      [0, 0, 0],
    ]),
    armTrack("mixamorig:Hips", heavyT, [
      [0, 0, 0],
      [0.08, 0.12, 0],
      [-0.05, -0.18, 0],
      [0, -0.05, 0],
      [0, 0, 0],
    ]),
  ]);

  const hitT = [0, 0.08, 0.28];
  const hit = new THREE.AnimationClip("Hit", 0.28, [
    armTrack("mixamorig:Spine1", hitT, [
      [0, 0, 0],
      [-0.35, 0.25, 0.15],
      [0, 0, 0],
    ]),
    armTrack("mixamorig:Hips", hitT, [
      [0, 0, 0],
      [-0.12, 0.1, 0],
      [0, 0, 0],
    ]),
  ]);

  const jumpT = [0, 0.12, 0.4, 0.7];
  const jump = new THREE.AnimationClip("Jump", 0.7, [
    armTrack("mixamorig:RightUpLeg", jumpT, [
      [0, 0, 0],
      [-0.85, 0, 0],
      [-0.4, 0, 0],
      [0, 0, 0],
    ]),
    armTrack("mixamorig:LeftUpLeg", jumpT, [
      [0, 0, 0],
      [-0.55, 0, 0],
      [-0.25, 0, 0],
      [0, 0, 0],
    ]),
    armTrack("mixamorig:Spine1", jumpT, [
      [0, 0, 0],
      [0.25, 0, 0],
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
  ]);

  return { Slash: slash, Heavy: heavy, Hit: hit, Jump: jump };
}
