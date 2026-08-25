/** Concord Humanoid Contract — Unity Avatar method, browser runtime. */

export const MIXAMO = {
  hips: "mixamorig:Hips",
  spine: "mixamorig:Spine",
  spine1: "mixamorig:Spine1",
  spine2: "mixamorig:Spine2",
  neck: "mixamorig:Neck",
  head: "mixamorig:Head",
  clavL: "mixamorig:LeftShoulder",
  clavR: "mixamorig:RightShoulder",
  armL: "mixamorig:LeftArm",
  armR: "mixamorig:RightArm",
  foreL: "mixamorig:LeftForeArm",
  foreR: "mixamorig:RightForeArm",
  handL: "mixamorig:LeftHand",
  handR: "mixamorig:RightHand",
  thighL: "mixamorig:LeftUpLeg",
  thighR: "mixamorig:RightUpLeg",
  shinL: "mixamorig:LeftLeg",
  shinR: "mixamorig:RightLeg",
  footL: "mixamorig:LeftFoot",
  footR: "mixamorig:RightFoot",
} as const;

/**
 * Mixamo Soldier.glb visor faces -Z at rotation.y = 0
 * (three.js skinning example: camera at z=-3 sees the face).
 * Concord forward is also (-sin(yaw), -cos(yaw)) = -Z at yaw 0.
 * Do not add PI — that shows the visor to a chase camera behind the player.
 */
export function visualYaw(heading: number) {
  return heading;
}

export const HAND_SOCKET = {
  pos: [0.02, 0.04, 0.08] as const,
  rot: [1.2, 0, 0.2] as const,
};
