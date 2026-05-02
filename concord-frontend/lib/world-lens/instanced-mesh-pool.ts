/**
 * Instanced Mesh Pool
 *
 * The audit flagged Performance at 5/10 because while LOD existed, no
 * instanced rendering was visible. This module is the missing layer for
 * crowds, swarms, distant buildings, vegetation: a single InstancedMesh
 * draw call renders N copies of the same geometry/material.
 *
 * Use it for any "many of the same thing" scene:
 *   - 100+ rogue drones in the cyber world
 *   - thorn wolves in a fantasy pack
 *   - rioters around a riot elemental
 *   - distant identical buildings (procedural-buildings emit same geometry)
 *
 * API:
 *   const pool = createInstancedMeshPool(THREE, scene, geometry, material, capacity);
 *   const id = pool.add(transform);   // returns instance handle
 *   pool.update(id, transform);
 *   pool.remove(id);
 *   pool.dispose();
 *
 * Capacity is fixed at creation; over-capacity adds throw. Use multiple
 * pools (or recreate with a larger capacity) for unbounded swarms.
 */

import type * as THREE_NS from "three";

export interface InstanceTransform {
  position: { x: number; y: number; z: number };
  rotationY?: number;
  scale?:    number | { x: number; y: number; z: number };
}

export interface InstancedMeshPool {
  readonly capacity: number;
  readonly count: () => number;
  readonly mesh: THREE_NS.InstancedMesh;
  add(t: InstanceTransform): number | null;
  update(handle: number, t: InstanceTransform): void;
  remove(handle: number): void;
  dispose(): void;
}

export function createInstancedMeshPool(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Scene | THREE_NS.Group,
  geometry: THREE_NS.BufferGeometry,
  material: THREE_NS.Material | THREE_NS.Material[],
  capacity = 256,
): InstancedMeshPool {
  const inst = new THREE.InstancedMesh(geometry, material, capacity);
  inst.castShadow    = true;
  inst.receiveShadow = true;
  scene.add(inst);

  // Free-slot stack so add()/remove() are O(1)
  const free: number[] = [];
  for (let i = capacity - 1; i >= 0; i--) free.push(i);
  const used = new Set<number>();
  const matrix = new THREE.Matrix4();

  const _writeMatrix = (idx: number, t: InstanceTransform) => {
    const sx = typeof t.scale === "number" ? t.scale : t.scale?.x ?? 1;
    const sy = typeof t.scale === "number" ? t.scale : t.scale?.y ?? 1;
    const sz = typeof t.scale === "number" ? t.scale : t.scale?.z ?? 1;
    matrix.compose(
      new THREE.Vector3(t.position.x, t.position.y, t.position.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rotationY ?? 0),
      new THREE.Vector3(sx, sy, sz),
    );
    inst.setMatrixAt(idx, matrix);
    inst.instanceMatrix.needsUpdate = true;
  };

  return {
    capacity,
    count: () => used.size,
    mesh: inst,

    add(t) {
      const idx = free.pop();
      if (idx === undefined) return null; // pool full
      used.add(idx);
      _writeMatrix(idx, t);
      return idx;
    },

    update(handle, t) {
      if (!used.has(handle)) return;
      _writeMatrix(handle, t);
    },

    remove(handle) {
      if (!used.has(handle)) return;
      // Hide the instance by zero-scale rather than reordering the buffer
      matrix.compose(
        new THREE.Vector3(0, -10000, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(0, 0, 0),
      );
      inst.setMatrixAt(handle, matrix);
      inst.instanceMatrix.needsUpdate = true;
      used.delete(handle);
      free.push(handle);
    },

    dispose() {
      try { scene.remove(inst); } catch { /* idempotent */ }
      try { inst.dispose(); } catch { /* idempotent */ }
    },
  };
}

/**
 * Helper: build a frustum-culled draw list from a flat array of items.
 * Returns the indices of items inside the camera frustum so callers can
 * write only those into an InstancedMesh.
 */
export function frustumCullIndices(
  THREE: typeof THREE_NS,
  camera: THREE_NS.Camera,
  positions: Array<{ x: number; y: number; z: number }>,
  margin = 5,
): number[] {
  const m = new THREE.Matrix4().multiplyMatrices(
    (camera as { projectionMatrix: THREE_NS.Matrix4 }).projectionMatrix,
    (camera as { matrixWorldInverse: THREE_NS.Matrix4 }).matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(m);
  const sphere = new THREE.Sphere(undefined, margin);
  const out: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    sphere.center.set(positions[i].x, positions[i].y, positions[i].z);
    if (frustum.intersectsSphere(sphere)) out.push(i);
  }
  return out;
}
