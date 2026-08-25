import * as THREE from "three";
import type { HumanoidBones } from "./humanoid-cert";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Two-bone IK. Rotates upper+lower so `end` reaches `target` (world). */
export function twoBoneIK(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
) {
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const lab = Math.max(0.001, _a.distanceTo(_b));
  const lbc = Math.max(0.001, _b.distanceTo(_c));
  const lat = Math.min(_a.distanceTo(target), lab + lbc - 0.002);
  if (lat < 0.002) return;

  _t.copy(target).sub(_a);
  const acLen = _t.length();
  if (acLen < 1e-5) return;

  const cosLower = THREE.MathUtils.clamp((lab * lab + lbc * lbc - lat * lat) / (2 * lab * lbc), -1, 1);
  const wantLower = Math.PI - Math.acos(cosLower);
  _axis.copy(_b).sub(_a).cross(_c.clone().sub(_b));
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
  _axis.normalize();
  const curLower = _b.clone().sub(_a).angleTo(_c.clone().sub(_b));
  _q.setFromAxisAngle(_axis, wantLower - curLower);
  lower.quaternion.premultiply(_q);

  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _t.copy(target).sub(_a);
  const from = _c.clone().sub(_a);
  if (from.lengthSq() < 1e-8 || _t.lengthSq() < 1e-8) return;
  from.normalize();
  _t.normalize();
  _q.setFromUnitVectors(from, _t);
  upper.quaternion.premultiply(_q);
}

export function lookIK(bones: HumanoidBones, lookYaw: number) {
  const neck = bones.neck;
  const head = bones.head;
  const y = THREE.MathUtils.clamp(lookYaw, -0.7, 0.7);
  neck?.rotateY(y * 0.45);
  head?.rotateY(y * 0.55);
}

export function plantFeet(bones: HumanoidBones, grounded: boolean, hop: number) {
  if (!grounded || hop > 0.08) return;
  bones.footL?.rotateX(0.12);
  bones.footR?.rotateX(0.12);
}

export function airPose(bones: HumanoidBones, hop: number) {
  if (hop <= 0.08) return;
  const k = Math.min(1, hop);
  bones.thighR?.rotateX(-0.75 * k);
  bones.thighL?.rotateX(-0.5 * k);
  bones.spine?.rotateX(0.18 * k);
}
