// concord-frontend/lib/robotics/urdf-fk.ts
//
// Real forward kinematics for an arbitrary URDF joint tree — general 3D
// joint axes and a branching link tree, not just a single planar chain.
// This is a genuine extension of the honesty principle behind the existing
// `robotics.forwardKinematics` macro (server/domains/robotics.js), which
// only solves a 2D single-serial-chain arm; a real URDF document can have
// joints on any axis and a tree with multiple branches, so this module
// implements the general case with the same "real math, never faked
// animation" standard.
//
// Framework-free by design (plain vec3/mat3 arrays, no three.js import) so
// the FK contract is unit-testable without mounting WebGL — same idiom as
// components/conkay/lattice-globe-motion.ts. The viewer component converts
// these poses into three.js objects only at render time.

import type { UrdfRobot, UrdfJoint, Vec3 } from './urdf-types';

/** Row-major 3x3: (Mv)_i = sum_j M[i*3+j] * v[j]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Pose {
  position: Vec3;
  rotation: Mat3;
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const IDENTITY_POSE: Pose = { position: [0, 0, 0], rotation: IDENTITY3 };

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function vec3Length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function vec3Normalize(a: Vec3): Vec3 {
  const len = vec3Length(a);
  return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : [1, 0, 0];
}

export function matMulVec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function matMulMat3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3 + 0] * b[0 * 3 + j] + a[i * 3 + 1] * b[1 * 3 + j] + a[i * 3 + 2] * b[2 * 3 + j];
    }
  }
  return r;
}

function mat3Add(a: Mat3, b: Mat3): Mat3 {
  return a.map((v, i) => v + b[i]) as Mat3;
}
function mat3Scale(a: Mat3, s: number): Mat3 {
  return a.map((v) => v * s) as Mat3;
}

function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** URDF's `rpy` is fixed-axis (extrinsic) roll-pitch-yaw: R = Rz(yaw) * Ry(pitch) * Rx(roll). */
export function eulerRpyToMat3(rpy: Vec3): Mat3 {
  const [roll, pitch, yaw] = rpy;
  return matMulMat3(rotZ(yaw), matMulMat3(rotY(pitch), rotX(roll)));
}

function skew(v: Vec3): Mat3 {
  const [x, y, z] = v;
  return [0, -z, y, z, 0, -x, -y, x, 0];
}

/** Rodrigues' rotation formula: rotate by `angle` radians about a unit `axis`. */
export function axisAngleToMat3(axisIn: Vec3, angle: number): Mat3 {
  if (Math.abs(angle) < 1e-12) return IDENTITY3;
  const axis = vec3Normalize(axisIn);
  const k = skew(axis);
  const k2 = matMulMat3(k, k);
  const s = Math.sin(angle), c = Math.cos(angle);
  return mat3Add(mat3Add(IDENTITY3, mat3Scale(k, s)), mat3Scale(k2, 1 - c));
}

export function composePose(parent: Pose, local: Pose): Pose {
  return {
    position: vec3Add(parent.position, matMulVec3(parent.rotation, local.position)),
    rotation: matMulMat3(parent.rotation, local.rotation),
  };
}

/**
 * Compute the per-joint local pose (origin transform composed with the
 * joint's own motion) for a given scalar joint value. Revolute/continuous
 * rotate about `axis` by `value` radians; prismatic translates along `axis`
 * by `value` meters; fixed/floating/planar apply the origin only — this
 * viewer drives a single scalar per joint (URDF's own convention for
 * revolute/continuous/prismatic), so floating/planar's extra multi-DOF
 * motion is honestly not animated (their origin transform still renders
 * correctly, it just doesn't move under a slider).
 */
export function jointLocalPose(joint: UrdfJoint, value: number): Pose {
  const originRot = eulerRpyToMat3(joint.origin.rpy);
  if (joint.type === 'revolute' || joint.type === 'continuous') {
    const jr = axisAngleToMat3(joint.axis, value);
    return { position: joint.origin.xyz, rotation: matMulMat3(originRot, jr) };
  }
  if (joint.type === 'prismatic') {
    const unitAxis = vec3Normalize(joint.axis);
    const translated = vec3Add(joint.origin.xyz, matMulVec3(originRot, vec3Scale(unitAxis, value)));
    return { position: translated, rotation: originRot };
  }
  return { position: joint.origin.xyz, rotation: originRot };
}

/**
 * Walk the URDF tree from its root(s) and compute the world pose of every
 * link. `jointValues` maps joint name → radians (revolute/continuous) or
 * meters (prismatic); joints not present default to 0. Real matrix
 * composition, not an approximation or a canned animation curve.
 */
export function computeUrdfFk(robot: UrdfRobot, jointValues: Record<string, number> = {}): Map<string, Pose> {
  const childLinkNames = new Set(robot.joints.map((j) => j.child));
  const jointsByParent = new Map<string, UrdfJoint[]>();
  for (const j of robot.joints) {
    const list = jointsByParent.get(j.parent) || [];
    list.push(j);
    jointsByParent.set(j.parent, list);
  }
  const roots = robot.links.map((l) => l.name).filter((n) => !childLinkNames.has(n));
  const poses = new Map<string, Pose>();

  function visit(linkName: string, parentPose: Pose) {
    if (poses.has(linkName)) return; // already placed — also guards against re-visiting on a malformed graph
    poses.set(linkName, parentPose);
    for (const j of jointsByParent.get(linkName) || []) {
      if (poses.has(j.child)) continue; // cycle guard, defense-in-depth (parseUrdf already rejects cycles)
      const value = jointValues[j.name] ?? 0;
      const localPose = jointLocalPose(j, value);
      visit(j.child, composePose(parentPose, localPose));
    }
  }
  for (const r of roots) visit(r, IDENTITY_POSE);
  // Any link a malformed/partial tree never reached still gets a pose so
  // callers always receive a complete map — placed at the world origin,
  // which is a visible, honest "disconnected" signal rather than a crash.
  for (const l of robot.links) if (!poses.has(l.name)) visit(l.name, IDENTITY_POSE);
  return poses;
}
