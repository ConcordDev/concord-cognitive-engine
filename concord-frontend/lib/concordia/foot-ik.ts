/**
 * Foot IK on uneven terrain.
 *
 * Per-frame solver that adjusts the FABRIK target Y for each foot based
 * on a raycast against the world's terrain mesh. Without this, feet
 * "float" on slopes (they follow the gait cycle as if on flat ground)
 * and "sink" on rises (they pierce through high terrain).
 *
 * Integration:
 *   const fik = createFootIK({ raycast });
 *   // each frame, after the gait pose is applied:
 *   fik.solve(leftFootBone, rightFootBone, contactL, contactR);
 *
 * `contactL` / `contactR` are gait-phase contact factors in [0..1]; 1
 * means the foot is fully planted, 0 means swing. Blend weight scales
 * the adjustment so swing-phase feet don't snap to terrain.
 */

import type * as THREE_NS from 'three';

export interface FootIKRaycaster {
  /**
   * Returns the terrain Y at world (x, z), or null if no terrain found.
   * Implementations typically wrap a THREE.Raycaster + cached terrain meshes.
   */
  groundYAt(x: number, z: number): number | null;
}

export interface FootIKOptions {
  /** Max upward adjustment in metres. Default 0.4 (stairs/curbs). */
  maxLift?: number;
  /** Max downward adjustment in metres. Default 0.6 (drops onto lower ground). */
  maxDrop?: number;
  /** Smoothing factor toward the target Y per frame [0..1]. Default 0.35. */
  smoothing?: number;
  /** Vertical offset added to the foot's ground-aligned position (sole thickness). Default 0.04. */
  soleHeight?: number;
}

export interface FootIKAPI {
  solve(
    leftFoot:  THREE_NS.Object3D,
    rightFoot: THREE_NS.Object3D,
    contactL:  number,
    contactR:  number,
  ): { adjustedL: number; adjustedR: number };
  reset(): void;
}

/**
 * Build a foot-IK solver bound to a raycaster.
 */
export function createFootIK(
  raycaster: FootIKRaycaster,
  options:   FootIKOptions = {},
): FootIKAPI {
  const maxLift    = options.maxLift    ?? 0.4;
  const maxDrop    = options.maxDrop    ?? 0.6;
  const smoothing  = Math.max(0, Math.min(1, options.smoothing ?? 0.35));
  const soleHeight = options.soleHeight ?? 0.04;

  // Persistent smoothing state per foot
  let smoothedL: number | null = null;
  let smoothedR: number | null = null;

  function clamp(v: number, lo: number, hi: number) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function solveOne(
    foot: THREE_NS.Object3D,
    contact: number,
    smoothed: number | null,
  ): { newY: number; smoothed: number } {
    const baseY = foot.position.y;
    const groundY = raycaster.groundYAt(foot.position.x, foot.position.z);
    if (groundY === null) {
      return { newY: baseY, smoothed: smoothed ?? baseY };
    }
    const targetY = groundY + soleHeight;
    const rawDelta = targetY - baseY;
    const clamped = clamp(rawDelta, -maxDrop, maxLift);
    const desired = baseY + clamped;
    const blend = Math.max(0, Math.min(1, contact));
    // Smooth the per-frame movement to avoid jitter
    const next = smoothed === null
      ? desired
      : smoothed + (desired - smoothed) * smoothing;
    const finalY = baseY + (next - baseY) * blend;
    return { newY: finalY, smoothed: next };
  }

  return {
    solve(leftFoot, rightFoot, contactL, contactR) {
      const lRes = solveOne(leftFoot, contactL, smoothedL);
      smoothedL = lRes.smoothed;
      leftFoot.position.y = lRes.newY;
      const rRes = solveOne(rightFoot, contactR, smoothedR);
      smoothedR = rRes.smoothed;
      rightFoot.position.y = rRes.newY;
      return { adjustedL: lRes.newY, adjustedR: rRes.newY };
    },

    reset() {
      smoothedL = null;
      smoothedR = null;
    },
  };
}

/**
 * Build a foot-IK raycaster that walks a THREE.Raycaster against a list
 * of terrain meshes (typically the InstancedGrass + terrain Group from
 * the world scene). Casts a downward ray from a high origin.
 */
export function createRaycastFootIKQuery(
  THREE: typeof THREE_NS,
  terrainObjects: () => THREE_NS.Object3D[],
  rayHeight = 50,
): FootIKRaycaster {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3(0, -1, 0);
  raycaster.far = rayHeight * 2;

  return {
    groundYAt(x: number, z: number) {
      origin.set(x, rayHeight, z);
      raycaster.set(origin, direction);
      const targets = terrainObjects();
      if (!targets || targets.length === 0) return null;
      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length === 0) return null;
      return hits[0].point.y;
    },
  };
}
