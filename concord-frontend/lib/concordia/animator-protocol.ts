// concord-frontend/lib/concordia/animator-protocol.ts
//
// Phase E — message protocol between the main thread and the avatar-animator
// Web Worker. THREE.Euler / Vector3 instances do NOT survive postMessage's
// structured clone, so the worker emits plain `{x,y,z}` objects and the
// main-thread hook rehydrates them into THREE objects before applying to
// bones.

import * as THREE from 'three';
import type { BodyType, GaitPose } from './gait-synthesis';
import type { MovementStyleConfig } from './movement-styles';

// ── Serializable shapes (no class prototypes) ────────────────────────────────

export interface SerializableVec3 { x: number; y: number; z: number; }
export interface SerializableEuler { x: number; y: number; z: number; order?: string; }

export interface SerializableGaitParams {
  speed: number;
  direction: number;
  slope: number;
  load: number;
  fatigue: number;
  bodyType: BodyType;
  style: MovementStyleConfig;
}

export interface SerializableGaitPose {
  hips:          SerializableEuler;
  hipOffset:     SerializableVec3;
  spine:         SerializableEuler;
  chest:         SerializableEuler;
  neck:          SerializableEuler;
  leftUpperLeg:  SerializableEuler;
  leftLowerLeg:  SerializableEuler;
  leftFoot:      SerializableEuler;
  rightUpperLeg: SerializableEuler;
  rightLowerLeg: SerializableEuler;
  rightFoot:     SerializableEuler;
  leftUpperArm:  SerializableEuler;
  leftForearm:   SerializableEuler;
  rightUpperArm: SerializableEuler;
  rightForearm:  SerializableEuler;
}

// ── Message envelopes ────────────────────────────────────────────────────────

export type AnimateRequest = {
  type: 'animate';
  avatarId: string;
  frameId: number;
  params: SerializableGaitParams;
  phase: number;
  delta: number;
};

export type AnimateResult = {
  type: 'animate-result';
  avatarId: string;
  frameId: number;
  pose: SerializableGaitPose;
  computeMs: number;
};

export type AnimateError = {
  type: 'animate-error';
  avatarId: string;
  frameId: number;
  error: string;
};

export type ReadyMessage = { type: 'ready' };

export type WorkerInbound = AnimateRequest;
export type WorkerOutbound = AnimateResult | AnimateError | ReadyMessage;

// ── (De)serialization helpers ────────────────────────────────────────────────

export function eulerToSerializable(e: { x: number; y: number; z: number; order?: string }): SerializableEuler {
  return { x: e.x, y: e.y, z: e.z, order: e.order };
}

export function vec3ToSerializable(v: { x: number; y: number; z: number }): SerializableVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function gaitPoseToSerializable(pose: GaitPose): SerializableGaitPose {
  return {
    hips:          eulerToSerializable(pose.hips),
    hipOffset:     vec3ToSerializable(pose.hipOffset),
    spine:         eulerToSerializable(pose.spine),
    chest:         eulerToSerializable(pose.chest),
    neck:          eulerToSerializable(pose.neck),
    leftUpperLeg:  eulerToSerializable(pose.leftUpperLeg),
    leftLowerLeg:  eulerToSerializable(pose.leftLowerLeg),
    leftFoot:      eulerToSerializable(pose.leftFoot),
    rightUpperLeg: eulerToSerializable(pose.rightUpperLeg),
    rightLowerLeg: eulerToSerializable(pose.rightLowerLeg),
    rightFoot:     eulerToSerializable(pose.rightFoot),
    leftUpperArm:  eulerToSerializable(pose.leftUpperArm),
    leftForearm:   eulerToSerializable(pose.leftForearm),
    rightUpperArm: eulerToSerializable(pose.rightUpperArm),
    rightForearm:  eulerToSerializable(pose.rightForearm),
  };
}

// ── Re-hydrate plain-object → THREE classes ─────────────────────────────
// Used by AvatarSystem3D when consuming worker-returned poses. The worker
// returns SerializableGaitPose (no class prototypes survive postMessage);
// applyGaitPose expects THREE.Euler / THREE.Vector3 instances.

function _toEuler(s: SerializableEuler): THREE.Euler {
  return new THREE.Euler(s.x, s.y, s.z, (s.order || 'XYZ') as THREE.EulerOrder);
}
function _toVec3(s: SerializableVec3): THREE.Vector3 {
  return new THREE.Vector3(s.x, s.y, s.z);
}

export function serializableToGaitPose(s: SerializableGaitPose): GaitPose {
  return {
    hips:          _toEuler(s.hips),
    hipOffset:     _toVec3(s.hipOffset),
    spine:         _toEuler(s.spine),
    chest:         _toEuler(s.chest),
    neck:          _toEuler(s.neck),
    leftUpperLeg:  _toEuler(s.leftUpperLeg),
    leftLowerLeg:  _toEuler(s.leftLowerLeg),
    leftFoot:      _toEuler(s.leftFoot),
    rightUpperLeg: _toEuler(s.rightUpperLeg),
    rightLowerLeg: _toEuler(s.rightLowerLeg),
    rightFoot:     _toEuler(s.rightFoot),
    leftUpperArm:  _toEuler(s.leftUpperArm),
    leftForearm:   _toEuler(s.leftForearm),
    rightUpperArm: _toEuler(s.rightUpperArm),
    rightForearm:  _toEuler(s.rightForearm),
  };
}
