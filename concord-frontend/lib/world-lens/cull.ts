// concord-frontend/lib/world-lens/cull.ts
//
// G1 — pure culling decision helpers, kept out of ConcordiaScene so the logic
// is unit-testable headless (THREE Frustum/Sphere intersection is done in the
// scene; the visible/distance decision lives here).

/** Squared distance between two points (avoids a sqrt in the hot loop). */
export function distanceSq(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Final visibility decision for a building given:
 *   - inFrustum: result of frustum.intersectsSphere(cachedSphere)
 *   - distSq: squared camera→building distance
 *   - maxDistance: hard render distance (beyond it, cull regardless of frustum)
 * A building renders only when it's both inside the frustum AND within range.
 * This is O(1) per building — no per-frame geometry traversal.
 */
export function decideVisible(inFrustum: boolean, distSq: number, maxDistance: number): boolean {
  if (!inFrustum) return false;
  if (maxDistance > 0 && distSq > maxDistance * maxDistance) return false;
  return true;
}
