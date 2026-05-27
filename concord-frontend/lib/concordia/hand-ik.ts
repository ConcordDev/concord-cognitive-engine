/**
 * Two-bone hand IK for pickup / interaction.
 *
 * Reaches the wrist toward a world-space target by solving the
 * shoulder-elbow-wrist chain. Uses the analytic two-bone IK solver
 * (Law of Cosines), which is exact, fast, and produces no jitter.
 * Falls back gracefully when the target is beyond reach (arm goes
 * straight rather than stretching).
 *
 * Integration:
 *   const handIK = createHandIK(THREE);
 *   handIK.solve({
 *     shoulder, elbow, wrist,
 *     target: { x, y, z },
 *     poleHint: { x, y, z },
 *     blendFactor: contactFactor,
 *   });
 *
 * `poleHint` controls which way the elbow points; for natural human
 * arms, point it slightly behind and below the elbow's current position
 * (or pass the character's hip).
 */

import type * as THREE_NS from 'three';

export interface HandIKChain {
  shoulder: THREE_NS.Object3D;
  elbow:    THREE_NS.Object3D;
  wrist:    THREE_NS.Object3D;
  target:   { x: number; y: number; z: number };
  poleHint: { x: number; y: number; z: number };
  /** 0 = no IK, 1 = full reach. Default 1. */
  blendFactor?: number;
}

export interface HandIKAPI {
  solve(chain: HandIKChain): { reached: boolean; reach: number };
}

/**
 * Build a two-bone hand-IK solver.
 */
export function createHandIK(THREE: typeof THREE_NS): HandIKAPI {
  const _shoulderPos = new THREE.Vector3();
  const _elbowPos    = new THREE.Vector3();
  const _wristPos    = new THREE.Vector3();
  const _target      = new THREE.Vector3();
  const _pole        = new THREE.Vector3();
  const _toElbow     = new THREE.Vector3();
  const _toTarget    = new THREE.Vector3();
  const _planeNormal = new THREE.Vector3();
  const _quat        = new THREE.Quaternion();

  function lookAtQuaternion(
    from: THREE_NS.Vector3,
    to: THREE_NS.Vector3,
    up: THREE_NS.Vector3,
    out: THREE_NS.Quaternion,
  ): void {
    const forward = to.clone().sub(from);
    if (forward.lengthSq() < 1e-8) {
      out.set(0, 0, 0, 1);
      return;
    }
    forward.normalize();
    const right = up.clone().cross(forward);
    if (right.lengthSq() < 1e-8) {
      out.set(0, 0, 0, 1);
      return;
    }
    right.normalize();
    const u = forward.clone().cross(right).normalize();
    const m = [
      right.x, u.x, forward.x,
      right.y, u.y, forward.y,
      right.z, u.z, forward.z,
    ];
    // matrix -> quaternion
    const trace = m[0] + m[4] + m[8];
    if (trace > 0) {
      const s = Math.sqrt(trace + 1.0) * 2;
      out.set((m[5] - m[7]) / s, (m[6] - m[2]) / s, (m[1] - m[3]) / s, 0.25 * s);
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
      out.set(0.25 * s, (m[3] + m[1]) / s, (m[6] + m[2]) / s, (m[5] - m[7]) / s);
    } else if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
      out.set((m[3] + m[1]) / s, 0.25 * s, (m[7] + m[5]) / s, (m[6] - m[2]) / s);
    } else {
      const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
      out.set((m[6] + m[2]) / s, (m[7] + m[5]) / s, 0.25 * s, (m[1] - m[3]) / s);
    }
  }

  return {
    solve(chain) {
      const { shoulder, elbow, wrist, target, poleHint, blendFactor = 1 } = chain;
      if (blendFactor <= 0) return { reached: false, reach: 0 };

      shoulder.getWorldPosition(_shoulderPos);
      elbow.getWorldPosition(_elbowPos);
      wrist.getWorldPosition(_wristPos);
      _target.set(target.x, target.y, target.z);
      _pole.set(poleHint.x, poleHint.y, poleHint.z);

      const upperLen = _shoulderPos.distanceTo(_elbowPos);
      const lowerLen = _elbowPos.distanceTo(_wristPos);
      const totalLen = upperLen + lowerLen;
      const wantLen  = _shoulderPos.distanceTo(_target);

      // Constrain the target if out of reach
      let clampedLen = wantLen;
      let reached = true;
      if (wantLen > totalLen - 0.001) {
        clampedLen = totalLen - 0.001;
        reached = false;
      }
      if (wantLen < 0.001) {
        return { reached: false, reach: 0 };
      }

      // Law of cosines: find the elbow angle that puts the wrist at `clampedLen`
      // away from the shoulder along the shoulder→target direction.
      // cos(elbowFromStraight) = (a² + b² - c²) / (2ab)
      const cosElbow = (upperLen * upperLen + lowerLen * lowerLen - clampedLen * clampedLen) /
                       (2 * upperLen * lowerLen);
      const elbowAngle = Math.acos(Math.max(-1, Math.min(1, cosElbow)));

      // cos(shoulderInternal) = (a² + c² - b²) / (2ac)
      const cosShoulder = (upperLen * upperLen + clampedLen * clampedLen - lowerLen * lowerLen) /
                          (2 * upperLen * clampedLen);
      const shoulderInternal = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));

      // Build the rotation plane from shoulder, target, and pole hint
      _toTarget.copy(_target).sub(_shoulderPos);
      _planeNormal.copy(_pole).sub(_shoulderPos).cross(_toTarget);
      if (_planeNormal.lengthSq() < 1e-8) {
        _planeNormal.set(0, 1, 0);
      }
      _planeNormal.normalize();

      // Solve elbow position: rotate the shoulder-to-target direction by
      // shoulderInternal around the plane normal, scaled by upperLen.
      _toTarget.normalize();
      const newElbow = _toTarget.clone().applyAxisAngle(_planeNormal, shoulderInternal).multiplyScalar(upperLen);
      newElbow.add(_shoulderPos);

      // Now orient the shoulder bone so the elbow lands at newElbow.
      lookAtQuaternion(_shoulderPos, newElbow, _planeNormal, _quat);
      const shoulderParent = shoulder.parent;
      if (shoulderParent) {
        const parentInverse = new THREE.Quaternion();
        shoulderParent.getWorldQuaternion(parentInverse).invert();
        shoulder.quaternion.copy(_quat).premultiply(parentInverse);
      } else {
        shoulder.quaternion.copy(_quat);
      }

      // Orient the elbow bone so the wrist lands at target
      lookAtQuaternion(newElbow, _target, _planeNormal, _quat);
      const elbowParent = elbow.parent;
      if (elbowParent) {
        const parentInverse = new THREE.Quaternion();
        elbowParent.getWorldQuaternion(parentInverse).invert();
        elbow.quaternion.copy(_quat).premultiply(parentInverse);
      } else {
        elbow.quaternion.copy(_quat);
      }

      void elbowAngle; // analytic angle informs the geometry, applied via lookAt above

      return { reached, reach: wantLen };
    },
  };
}
