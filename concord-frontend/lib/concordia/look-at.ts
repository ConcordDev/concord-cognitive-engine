/**
 * Look-at head tracking.
 *
 * Smoothly rotates a head bone so the character's face points at a
 * target world position, clamped to neck ROM. Without this, characters
 * stare blankly forward while NPCs walk past, breaking the illusion of
 * awareness. With it, NPCs and the player track interesting things in
 * their FOV.
 *
 * Integration:
 *   const lookAt = createLookAtSolver(THREE);
 *   // each frame, after gait pose is applied:
 *   lookAt.apply(headBone, targetWorldPos, headWorldPos, blendFactor);
 *
 * `blendFactor ∈ [0..1]` controls how strongly to slerp toward the
 * target; 0 = ignore, 1 = full lock. Typically scale by closeness +
 * line-of-sight + interest factor in the caller.
 */

import type * as THREE_NS from 'three';

export interface LookAtOptions {
  /** Yaw clamp ±degrees. Default 70 (neck physiological range). */
  maxYawDeg?:   number;
  /** Pitch clamp ±degrees. Default 50. */
  maxPitchDeg?: number;
  /** Slerp speed per frame (0..1). Default 0.18 — smooth, no snap. */
  slerpSpeed?:  number;
  /** Forward-axis convention; default +Z (Three.js standard).  */
  forwardAxis?: { x: number; y: number; z: number };
}

export interface LookAtAPI {
  apply(
    headBone:     THREE_NS.Object3D,
    targetWorld:  { x: number; y: number; z: number },
    headWorld:    { x: number; y: number; z: number },
    blendFactor:  number,
  ): void;
  /** Force the head back to its rest orientation immediately. */
  reset(headBone: THREE_NS.Object3D): void;
}

/**
 * Create a look-at solver. The solver smooths between frames so look
 * changes feel like natural head turns rather than instant snaps.
 */
export function createLookAtSolver(
  THREE: typeof THREE_NS,
  options: LookAtOptions = {},
): LookAtAPI {
  const maxYawRad   = ((options.maxYawDeg   ?? 70) * Math.PI) / 180;
  const maxPitchRad = ((options.maxPitchDeg ?? 50) * Math.PI) / 180;
  const slerpSpeed  = Math.max(0.01, Math.min(1, options.slerpSpeed ?? 0.18));
  const forwardAxis = options.forwardAxis ?? { x: 0, y: 0, z: 1 };

  const _baseForward = new THREE.Vector3(forwardAxis.x, forwardAxis.y, forwardAxis.z).normalize();
  const _wantDir = new THREE.Vector3();
  const _targetQuat = new THREE.Quaternion();
  const _baseQuat = new THREE.Quaternion();
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _scratchQuat = new THREE.Quaternion();

  function clamp(v: number, lo: number, hi: number) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  return {
    apply(headBone, targetWorld, headWorld, blendFactor) {
      const dx = targetWorld.x - headWorld.x;
      const dy = (targetWorld.y ?? headWorld.y ?? 0) - (headWorld.y ?? 0);
      const dz = targetWorld.z - headWorld.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < 1e-6 || blendFactor <= 0) return;

      _wantDir.set(dx, dy, dz).normalize();

      // Build a quaternion that rotates the head's forward axis to the want
      // direction in world space, then convert to local-bone space via the
      // parent's inverse world rotation.
      _targetQuat.setFromUnitVectors(_baseForward, _wantDir);

      // Decompose to Euler in the YXZ ordering (yaw, pitch, roll) so we can
      // clamp neck rotation independently. Yaw is body-left/right turn.
      _euler.setFromQuaternion(_targetQuat);
      _euler.y = clamp(_euler.y, -maxYawRad, maxYawRad);
      _euler.x = clamp(_euler.x, -maxPitchRad, maxPitchRad);
      _euler.z = 0; // no roll on look-at; preserve the gait spine roll separately
      _targetQuat.setFromEuler(_euler);

      // Blend the head's current quaternion toward target * blendFactor *
      // slerpSpeed. Two-stage so the look feels like a natural ease.
      _baseQuat.copy(headBone.quaternion);
      const t = slerpSpeed * Math.max(0, Math.min(1, blendFactor));
      _scratchQuat.copy(_baseQuat).slerp(_targetQuat, t);
      headBone.quaternion.copy(_scratchQuat);
    },

    reset(headBone) {
      headBone.quaternion.set(0, 0, 0, 1);
    },
  };
}
